CREATE USER IF NOT EXISTS 'studycafe_user'@'%' IDENTIFIED BY 'GDZ@p84i-F2X';
GRANT ALL ON studycafe_db.* TO 'studycafe_user'@'%';
FLUSH PRIVILEGES;
