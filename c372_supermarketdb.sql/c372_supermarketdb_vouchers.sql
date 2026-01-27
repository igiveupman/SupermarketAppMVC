-- Table structure for table `vouchers`

DROP TABLE IF EXISTS `vouchers`;
CREATE TABLE `vouchers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `code` varchar(40) NOT NULL UNIQUE,
  `amount` decimal(10,2) NOT NULL,
  `discount_type` varchar(10) NOT NULL DEFAULT 'fixed',
  `user_id` int DEFAULT NULL,
  `max_uses` int NOT NULL DEFAULT '1',
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `expires_at` datetime NOT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `created_by_admin_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `vouchers_user_id_idx` (`user_id`),
  KEY `vouchers_admin_id_idx` (`created_by_admin_id`),
  CONSTRAINT `vouchers_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `vouchers_admin_id_fk` FOREIGN KEY (`created_by_admin_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
