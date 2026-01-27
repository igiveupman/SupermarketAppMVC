-- Table structure for table `voucher_redemptions`

DROP TABLE IF EXISTS `voucher_redemptions`;
CREATE TABLE `voucher_redemptions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `voucher_id` int NOT NULL,
  `user_id` int NOT NULL,
  `order_id` int NOT NULL,
  `redeemed_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_voucher_user` (`voucher_id`,`user_id`),
  KEY `voucher_redemptions_user_id_idx` (`user_id`),
  KEY `voucher_redemptions_order_id_idx` (`order_id`),
  CONSTRAINT `voucher_redemptions_voucher_id_fk` FOREIGN KEY (`voucher_id`) REFERENCES `vouchers` (`id`) ON DELETE CASCADE,
  CONSTRAINT `voucher_redemptions_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `voucher_redemptions_order_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
