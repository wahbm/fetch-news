CREATE TABLE IF NOT EXISTS admin_guard (id INT PRIMARY KEY);
INSERT IGNORE INTO admin_guard (id) VALUES (1);
CREATE TABLE IF NOT EXISTS admins (
 id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, username VARCHAR(80) NOT NULL UNIQUE,
 password_hash VARCHAR(255) NOT NULL, enabled BOOLEAN NOT NULL DEFAULT 1,
 created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3)
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 admin_id INT UNSIGNED NOT NULL, expires_at DATETIME(3) NOT NULL,
 FOREIGN KEY (admin_id) REFERENCES admins(id), INDEX (expires_at)
);
CREATE TABLE IF NOT EXISTS topics (
 id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(120) NOT NULL UNIQUE, note TEXT NOT NULL,
 enabled BOOLEAN NOT NULL DEFAULT 1, created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3), INDEX (enabled,id)
);
CREATE TABLE IF NOT EXISTS callers (
 id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(120) NOT NULL,
 key_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE, key_prefix VARCHAR(16) NOT NULL,
 enabled BOOLEAN NOT NULL DEFAULT 1, last_used_at DATETIME(3), created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3)
);
CREATE TABLE IF NOT EXISTS articles (
 id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, topic_id INT UNSIGNED NOT NULL, caller_id INT UNSIGNED NOT NULL,
 article_date DATE NOT NULL, title VARCHAR(500) NOT NULL, ai_summary TEXT NOT NULL, content MEDIUMTEXT NOT NULL,
 url TEXT NOT NULL, url_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
 UNIQUE KEY article_dedup (topic_id,url_hash), INDEX (topic_id,article_date,id), INDEX (article_date,id),
 FOREIGN KEY (topic_id) REFERENCES topics(id), FOREIGN KEY (caller_id) REFERENCES callers(id)
);
CREATE TABLE IF NOT EXISTS subscribers (
 id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(120) NOT NULL,
 key_cipher TEXT NOT NULL, key_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
 key_suffix VARCHAR(4) NOT NULL, all_topics BOOLEAN NOT NULL DEFAULT 0, enabled BOOLEAN NOT NULL DEFAULT 1,
 next_send_at DATETIME(3), created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3)
);
CREATE TABLE IF NOT EXISTS subscriber_topics (
 subscriber_id INT UNSIGNED NOT NULL, topic_id INT UNSIGNED NOT NULL, PRIMARY KEY (subscriber_id,topic_id),
 FOREIGN KEY (subscriber_id) REFERENCES subscribers(id), FOREIGN KEY (topic_id) REFERENCES topics(id)
);
CREATE TABLE IF NOT EXISTS notifications (
 id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, subscriber_id INT UNSIGNED NOT NULL, article_id INT UNSIGNED,
 kind ENUM('article','test') NOT NULL DEFAULT 'article',
 status ENUM('pending','sending','retry','sent','failed','cancelled') NOT NULL DEFAULT 'pending',
 attempts INT NOT NULL DEFAULT 0, generation INT NOT NULL DEFAULT 1,
 next_attempt_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3), lease_until DATETIME(3), lease_token CHAR(32),
 last_error VARCHAR(500), created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3), sent_at DATETIME(3),
 UNIQUE KEY notification_dedup (subscriber_id,article_id), INDEX (status,next_attempt_at),
 FOREIGN KEY (subscriber_id) REFERENCES subscribers(id), FOREIGN KEY (article_id) REFERENCES articles(id)
);
CREATE TABLE IF NOT EXISTS notification_attempts (
 id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, notification_id INT UNSIGNED NOT NULL,
 generation INT NOT NULL, attempt INT NOT NULL, outcome VARCHAR(30) NOT NULL, error VARCHAR(500),
 created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3), finished_at DATETIME(3),
 FOREIGN KEY (notification_id) REFERENCES notifications(id), INDEX (notification_id,id)
);
