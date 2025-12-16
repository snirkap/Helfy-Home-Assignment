const { Kafka } = require('kafkajs');
const express = require('express');
const client = require('prom-client');
const winston = require('winston');
const fs = require('fs');
const path = require('path');

// ============================================
// Configuration
// ============================================
const config = {
  kafka: {
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
    topic: process.env.KAFKA_TOPIC || 'cdc_events',
    groupId: process.env.KAFKA_GROUP_ID || 'cdc-consumer-group',
  },
  prometheus: {
    port: parseInt(process.env.PROMETHEUS_PORT || '3000'),
  },
  logging: {
    file: process.env.LOG_FILE || '/var/log/consumer/cdc-events.log',
  },
};

// ============================================
// Ensure log directory exists
// ============================================
const logDir = path.dirname(config.logging.file);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// ============================================
// Winston Logger Setup
// ============================================
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { app_name: 'cdc-consumer' },
  transports: [
    // Write all logs to file (for Filebeat to pick up)
    new winston.transports.File({
      filename: config.logging.file,
      maxsize: 50 * 1024 * 1024, // 50MB
      maxFiles: 5,
    }),
    // Also log to console
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
  ],
});

// ============================================
// Prometheus Metrics Setup
// ============================================
const register = new client.Registry();

// Add default metrics
client.collectDefaultMetrics({ register });

// CDC events counter with table_name and operation dimensions
const cdcEventsCounter = new client.Counter({
  name: 'cdc_events_total',
  help: 'Total number of CDC events processed',
  labelNames: ['table_name', 'operation'],
  registers: [register],
});

// Additional metrics for monitoring
const cdcEventsProcessingTime = new client.Histogram({
  name: 'cdc_events_processing_seconds',
  help: 'Time spent processing CDC events',
  labelNames: ['table_name', 'operation'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
  registers: [register],
});

const kafkaMessagesReceived = new client.Counter({
  name: 'kafka_messages_received_total',
  help: 'Total number of Kafka messages received',
  registers: [register],
});

// ============================================
// Express Server for Prometheus Metrics
// ============================================
const app = express();

app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).end(err);
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// ============================================
// Parse CDC Event (Canal JSON format)
// ============================================
function parseCdcEvent(message) {
  try {
    const event = JSON.parse(message);

    // Canal JSON format structure
    // {
    //   "id": 0,
    //   "database": "app_db",
    //   "table": "users",
    //   "pkNames": ["id"],
    //   "isDdl": false,
    //   "type": "INSERT" | "UPDATE" | "DELETE",
    //   "es": 1234567890123,
    //   "ts": 1234567890123,
    //   "sql": "",
    //   "sqlType": {...},
    //   "mysqlType": {...},
    //   "data": [...],
    //   "old": [...]
    // }

    return {
      database: event.database || 'unknown',
      table: event.table || 'unknown',
      operation: (event.type || 'UNKNOWN').toLowerCase(),
      isDdl: event.isDdl || false,
      timestamp: event.ts || Date.now(),
      data: event.data || [],
      old: event.old || [],
      raw: event,
    };
  } catch (error) {
    logger.error('Failed to parse CDC event', { error: error.message, message });
    return null;
  }
}

// ============================================
// Process CDC Event
// ============================================
function processCdcEvent(parsedEvent) {
  const end = cdcEventsProcessingTime.startTimer({
    table_name: parsedEvent.table,
    operation: parsedEvent.operation,
  });

  try {
    // Map operation types to standard format
    let operation = parsedEvent.operation;
    if (operation === 'insert') operation = 'insert';
    else if (operation === 'update') operation = 'update';
    else if (operation === 'delete') operation = 'delete';
    else operation = 'unknown';

    // Increment Prometheus counter
    cdcEventsCounter.inc({
      table_name: parsedEvent.table,
      operation: operation,
    });

    // Log the CDC event (this will be picked up by Filebeat)
    logger.info('CDC Event Processed', {
      eventType: 'cdc_event',
      database: parsedEvent.database,
      table_name: parsedEvent.table,
      operation: operation,
      isDdl: parsedEvent.isDdl,
      timestamp: parsedEvent.timestamp,
      dataCount: parsedEvent.data.length,
      data: parsedEvent.data,
      old: parsedEvent.old,
    });

    return true;
  } catch (error) {
    logger.error('Error processing CDC event', { error: error.message });
    return false;
  } finally {
    end();
  }
}

// ============================================
// Kafka Consumer Setup
// ============================================
async function startConsumer() {
  const kafka = new Kafka({
    clientId: 'cdc-consumer',
    brokers: config.kafka.brokers,
    retry: {
      initialRetryTime: 1000,
      retries: 10,
    },
  });

  const consumer = kafka.consumer({ groupId: config.kafka.groupId });

  // Handle graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down consumer...');
    await consumer.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    logger.info('Connecting to Kafka...', { brokers: config.kafka.brokers });
    await consumer.connect();
    logger.info('Connected to Kafka successfully');

    logger.info('Subscribing to topic...', { topic: config.kafka.topic });
    await consumer.subscribe({ topic: config.kafka.topic, fromBeginning: false });
    logger.info('Subscribed to topic successfully');

    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        kafkaMessagesReceived.inc();

        const messageValue = message.value?.toString();
        if (!messageValue) {
          logger.warn('Received empty message', { topic, partition });
          return;
        }

        logger.debug('Received Kafka message', {
          topic,
          partition,
          offset: message.offset,
          timestamp: message.timestamp,
        });

        const parsedEvent = parseCdcEvent(messageValue);
        if (parsedEvent) {
          // Skip DDL events (schema changes)
          if (parsedEvent.isDdl) {
            logger.info('Skipping DDL event', { database: parsedEvent.database });
            return;
          }

          processCdcEvent(parsedEvent);
        }
      },
    });

    logger.info('Kafka consumer is running');
  } catch (error) {
    logger.error('Failed to start Kafka consumer', { error: error.message });
    throw error;
  }
}

// ============================================
// Main Entry Point
// ============================================
async function main() {
  logger.info('Starting CDC Consumer Service', { config });

  // Start Express server for metrics
  app.listen(config.prometheus.port, () => {
    logger.info(`Prometheus metrics server listening on port ${config.prometheus.port}`);
  });

  // Retry logic for Kafka connection
  let retries = 0;
  const maxRetries = 30;
  const retryDelay = 5000;

  while (retries < maxRetries) {
    try {
      await startConsumer();
      break;
    } catch (error) {
      retries++;
      logger.warn(`Failed to connect to Kafka, retrying... (${retries}/${maxRetries})`, {
        error: error.message,
      });

      if (retries >= maxRetries) {
        logger.error('Max retries reached, exiting...');
        process.exit(1);
      }

      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }
}

main().catch((error) => {
  logger.error('Fatal error', { error: error.message });
  process.exit(1);
});
