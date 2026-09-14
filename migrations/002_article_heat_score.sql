ALTER TABLE articles
  ADD COLUMN heat_score DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER ai_summary,
  ADD INDEX articles_heat_rank (article_date, heat_score, id);
