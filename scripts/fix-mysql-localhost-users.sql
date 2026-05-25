CREATE USER IF NOT EXISTS 'studycafe_user'@'%' IDENTIFIED BY '__MYSQL_PASSWORD__';
GRANT ALL ON studycafe_db.* TO 'studycafe_user'@'%';
FLUSH PRIVILEGES;
