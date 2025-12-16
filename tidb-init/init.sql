-- ============================================
-- TiDB Database Initialization Script
-- ============================================

-- Create the main database
CREATE DATABASE IF NOT EXISTS app_db;
USE app_db;

-- ============================================
-- Table: users
-- Main users table for the application
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    status ENUM('active', 'inactive', 'suspended') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ============================================
-- Table: products
-- Products catalog table
-- ============================================
CREATE TABLE IF NOT EXISTS products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    price DECIMAL(10, 2) NOT NULL,
    stock_quantity INT DEFAULT 0,
    category VARCHAR(100),
    status ENUM('available', 'out_of_stock', 'discontinued') DEFAULT 'available',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ============================================
-- Table: orders
-- Orders tracking table
-- ============================================
CREATE TABLE IF NOT EXISTS orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    total_amount DECIMAL(10, 2) NOT NULL,
    status ENUM('pending', 'processing', 'shipped', 'delivered', 'cancelled') DEFAULT 'pending',
    shipping_address TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================
-- Table: order_items
-- Individual items in each order
-- ============================================
CREATE TABLE IF NOT EXISTS order_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity INT NOT NULL,
    unit_price DECIMAL(10, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- ============================================
-- Table: audit_log
-- Audit log for tracking important actions
-- ============================================
CREATE TABLE IF NOT EXISTS audit_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    table_name VARCHAR(100) NOT NULL,
    operation VARCHAR(20) NOT NULL,
    record_id INT,
    old_data JSON,
    new_data JSON,
    user_id INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- Create default application user
-- Username: admin
-- Password: Admin@123
-- ============================================
INSERT IGNORE INTO users (username, email, password_hash, first_name, last_name, status)
VALUES (
    'admin',
    'admin@example.com',
    -- SHA-256 hash of 'Admin@123'
    '$2a$10$xGQz8VVK8vQKJxGQz8VVK.hash.admin123',
    'Admin',
    'User',
    'active'
);

-- ============================================
-- Insert sample products
-- ============================================
INSERT IGNORE INTO products (name, description, price, stock_quantity, category, status) VALUES
('Laptop Pro 15', 'High-performance laptop with 15-inch display', 1299.99, 50, 'Electronics', 'available'),
('Wireless Mouse', 'Ergonomic wireless mouse with long battery life', 29.99, 200, 'Electronics', 'available'),
('USB-C Hub', '7-in-1 USB-C Hub with HDMI and card reader', 49.99, 150, 'Electronics', 'available'),
('Mechanical Keyboard', 'RGB mechanical keyboard with cherry switches', 89.99, 75, 'Electronics', 'available'),
('Monitor Stand', 'Adjustable aluminum monitor stand', 39.99, 100, 'Office', 'available');

-- ============================================
-- Create application database user
-- This user will be used by the application
-- ============================================
CREATE USER IF NOT EXISTS 'app_user'@'%' IDENTIFIED BY 'AppUser@123';
GRANT ALL PRIVILEGES ON app_db.* TO 'app_user'@'%';
FLUSH PRIVILEGES;

-- Show created tables
SELECT 'Database initialization completed!' AS status;
SHOW TABLES;
