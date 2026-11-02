CREATE TABLE article_tags (
 id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 name VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL UNIQUE
);
CREATE TABLE article_tag_links (
 article_id INT UNSIGNED NOT NULL, tag_id INT UNSIGNED NOT NULL,
 PRIMARY KEY (article_id,tag_id), INDEX (tag_id,article_id),
 FOREIGN KEY (article_id) REFERENCES articles(id),
 FOREIGN KEY (tag_id) REFERENCES article_tags(id)
);
