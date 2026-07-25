-- Generated 2026-07-03T03:06:27.551Z
PRAGMA foreign_keys = OFF;
DELETE FROM session_snapshots;
DELETE FROM chat_messages;
DELETE FROM live_visitors;
DELETE FROM therapy_sessions;
DELETE FROM payment_links;
DELETE FROM clients;
DELETE FROM consultations;
DELETE FROM blocked_slots;
DELETE FROM visitor_log;
DELETE FROM settings WHERE setting_key IN ('admin_password','hours_windows','default_price_cents');
INSERT INTO `settings` (`setting_key`, `setting_value`) VALUES
('admin_password', 'Saphire777!'),
('default_price_cents', '29900'),
('hours_windows', '13-15,19-21');
INSERT INTO `blocked_slots` (`id`, `blocked_dt`, `reason`, `created_at`) VALUES
(1, '2026-04-06 14:00:00', 'Blocked by admin', '2026-04-06 10:05:31'),
(2, '2026-04-06 20:30:00', 'Blocked by admin', '2026-04-06 11:36:39'),
(3, '2026-04-06 13:00:00', 'Blocked by admin', '2026-04-06 12:44:21'),
(4, '2026-04-06 13:30:00', 'Blocked by admin', '2026-04-06 12:44:27'),
(5, '2026-04-06 20:00:00', 'Blocked by admin', '2026-04-06 12:44:27'),
(6, '2026-04-06 19:30:00', 'Blocked by admin', '2026-04-06 12:44:28'),
(7, '2026-04-07 13:00:00', 'Full day blocked', '2026-04-06 12:47:02'),
(8, '2026-04-07 19:00:00', 'Full day blocked', '2026-04-06 12:47:02'),
(9, '2026-04-07 20:30:00', 'Full day blocked', '2026-04-06 12:47:02'),
(10, '2026-04-07 14:00:00', 'Full day blocked', '2026-04-06 12:47:02'),
(11, '2026-04-07 13:30:00', 'Full day blocked', '2026-04-06 12:47:02'),
(12, '2026-04-07 14:30:00', 'Full day blocked', '2026-04-06 12:47:02'),
(13, '2026-04-07 19:30:00', 'Full day blocked', '2026-04-06 12:47:02'),
(14, '2026-04-07 20:00:00', 'Full day blocked', '2026-04-06 12:47:02');
INSERT INTO `clients` (`id`, `consultation_id`, `first_name`, `last_name`, `email`, `phone`, `phobia`, `q_intensity`, `archived`, `created_at`) VALUES
(1, 53, 'steve', 'shaw', 'soyuzlaunch@gmail.com', '8637129312', 'Fear of the Dark', '', 1, '2026-06-15 03:32:42'),
(4, 59, 'SDF', 'SDF', 'SDF@GMAIL.COM', '', 'Fear of Ferns', '', 1, '2026-06-16 01:19:12'),
(5, 58, 'SDF', 'SDF', 'SDF@GMAIL.COM', '', 'Fear of Snakes', '', 1, '2026-06-16 01:19:12'),
(6, 57, 'ASD', 'asd', 'ADSA@GMAIL.COM', '', 'Fear of Phone Calls', '', 1, '2026-06-16 01:19:12'),
(7, 56, 'dg', 'dg', 'dg@gmail.com', '', 'Fear of Clowns', '', 1, '2026-06-16 01:19:12'),
(8, 55, 'asdf', 'asdf', 'asdf@gmail.com', '', 'Fear of Dogs', '', 1, '2026-06-16 01:19:12'),
(9, 54, 'sdf', 'sdf', 'sdf@gmail.com', '', 'Fear of Plants', '', 1, '2026-06-16 01:19:12');
INSERT INTO `payment_links` (`id`, `token`, `consultation_id`, `client_name`, `client_email`, `amount_cents`, `description`, `used`, `paid`, `stripe_payment_intent`, `created_at`, `paid_at`) VALUES
(24, '68d804fdbdf5f71afea3aa44036aba1364b5f3dbe17de932b5be08f57b62c1d9', 5, 'steve shaw', 'soyuzlaunch@gmail.com', 100, 'PhobiaFree â€” Single Session', 0, 0, NULL, '2026-06-15 03:34:59', NULL),
(25, '1f066f19fb3d8ab096dece5228dc455f57b801bfbde4f7c0c66977e7217ed812', 5, 'steve shaw', 'soyuzlaunch@gmail.com', 100, 'PhobiaFree â€” Single Session', 0, 0, NULL, '2026-06-15 03:35:08', NULL);
INSERT INTO `visitor_log` (`id`, `vid`, `ip`, `location`, `device`, `first_seen`, `last_seen`, `total_seconds`, `pages`) VALUES
(232, 'v_fi0s1pumx_mqfyhqe5', '104.203.152.93', 'Naples, Florida, US', 'Windows', '2026-06-15 21:21:19', '2026-06-16 07:42:02', 54885, '[\"welcome\",\"ophidiophobia\",\"\\u2605 Opened\",\"nosocomephobia\",\"trypanophobia\",\"my_fear\",\"aerophobia\",\"\\u2605 Opened\"]'),
(233, 'v_66cphac79_mqfwyalx', '104.203.152.93', 'Naples, Florida, US', 'iPhone', '2026-06-16 08:06:25', '2026-06-16 08:06:35', 15, '[\"ophidiophobia\"]'),
(234, 'v_eghjzyu8y_mqgm7eoh', '104.203.152.93', 'Naples, Florida, US', 'Mac', '2026-06-16 08:25:11', '2026-06-27 09:02:06', 450, '[\"welcome\",\"scopophobia\"]'),
(235, 'v_4xr449s2v_mqfhf3ih', '104.203.152.93', 'Naples, Florida, US', 'Windows', '2026-06-16 10:39:39', '2026-06-16 10:46:59', 2640, '[\"welcome\",\"amaxophobia\",\"\\u2605 Opened\",\"coulrophobia\",\"aquaphobia\",\"phobia-template\"]'),
(236, 'v_79on1zvlu_mqgrv0pg', '104.203.152.93', 'Naples, Florida, US', 'Windows', '2026-06-16 11:03:32', '2026-06-17 00:30:06', 7060, '[\"welcome\",\"arachnophobia\"]'),
(237, 'v_n0ja7c6z2_mqgwjotm', '66.249.92.6', 'Mountain View, California, US', 'Android Phone', '2026-06-16 13:14:58', '2026-06-16 13:14:58', 5, '[\"my_fear\"]'),
(238, 'v_mxccwjwv1_mqgzjj0w', '74.125.212.1', 'Mountain View, California, US', 'Desktop', '2026-06-16 14:38:28', '2026-06-16 14:38:30', 50, '[\"welcome\"]'),
(239, 'v_or82drcxp_mqhf19qk', '104.203.152.93', 'Naples, Florida, US', 'Windows', '2026-06-16 21:52:15', '2026-06-16 21:52:15', 5, '[\"welcome\"]'),
(240, 'v_tgdz05zdh_mqhl1u45', '104.203.152.93', 'Naples, Florida, US', 'Windows', '2026-06-17 00:40:38', '2026-06-17 00:40:48', 20, '[\"welcome\"]'),
(241, 'v_2g3iw9n16_mqhpzzkc', '104.203.152.93', 'Naples, Florida, US', 'iPhone', '2026-06-17 02:59:10', '2026-06-17 02:59:20', 15, '[\"welcome\"]'),
(242, 'v_n0ja7c6z2_mqhvlr8i', '74.125.150.129', 'Mountain View, California, US', 'Android Phone', '2026-06-17 05:58:30', '2026-06-17 05:58:30', 5, '[\"emetophobia\"]'),
(243, 'v_n0ja7c6z2_mqhwr5z6', '74.125.150.128', 'Mountain View, California, US', 'Android Phone', '2026-06-17 06:22:36', '2026-06-17 06:22:36', 5, '[\"iatrophobia\"]'),
(244, 'v_z1b5izmq6_mqhxglto', '104.203.152.93', 'Naples, Florida, US', 'Windows', '2026-06-17 06:28:00', '2026-06-17 06:28:01', 30, '[\"welcome\"]'),
(245, 'v_n0ja7c6z2_mqhxe0ia', '74.125.150.128', 'Mountain View, California, US', 'Android Phone', '2026-06-17 07:12:03', '2026-06-17 07:12:03', 5, '[\"pteridophobia\"]'),
(246, 'v_n0ja7c6z2_mqhxp4yy', '74.125.150.129', 'Mountain View, California, US', 'Android Phone', '2026-06-17 07:22:08', '2026-06-17 07:22:08', 5, '[\"nosocomephobia\"]'),
(247, 'v_sstdob4bz_mqi7szz4', '104.203.152.93', 'Naples, Florida, US', 'iPhone', '2026-06-17 11:17:37', '2026-06-17 11:18:09', 35, '[\"welcome\"]'),
(248, 'v_ocox5rrv3_mqifc2ii', '74.125.212.1', 'Mountain View, California, US', 'Desktop', '2026-06-17 14:48:20', '2026-06-17 14:48:22', 50, '[\"welcome\"]'),
(249, 'v_zl3z4r9g2_mqikqkyb', '104.203.152.93', 'Naples, Florida, US', 'Windows', '2026-06-17 17:19:39', '2026-06-17 17:19:39', 5, '[\"welcome\"]'),
(250, 'v_yda8cqjvp_mqjes3i4', '104.203.152.93', 'Naples, Florida, US', 'iPhone', '2026-06-18 07:21:15', '2026-06-18 07:21:17', 35, '[\"welcome\"]'),
(251, 'v_w52zvia5p_mqlcczk9', '181.94.227.98', 'AsunciÃ³n, Asuncion, PY', 'Windows', '2026-06-19 15:48:21', '2026-06-19 21:00:18', 525, '[\"welcome\",\"my_fear\"]'),
(252, 'v_mzpgvw2pz_mqm3c2sf', '74.125.150.130', 'Mountain View, California, US', 'Android Phone', '2026-06-20 04:24:26', '2026-06-20 04:24:26', 5, '[\"sales-call-anxiety\"]'),
(253, 'v_n0ja7c6z2_mqm40idu', '74.125.150.128', 'Mountain View, California, US', 'Android Phone', '2026-06-20 04:43:15', '2026-06-20 04:43:15', 5, '[\"dentophobia\"]'),
(254, 'v_md6r62618_mqmiflmv', '181.94.227.98', 'AsunciÃ³n, Asuncion, PY', 'Windows', '2026-06-20 11:26:07', '2026-06-20 12:39:15', 1500, '[\"welcome\",\"my_fear\",\"contact\"]'),
(255, 'v_6hyet0hlk_mqmp2103', '74.125.212.1', 'Mountain View, California, US', 'Desktop', '2026-06-20 14:31:33', '2026-06-20 14:31:34', 50, '[\"welcome\"]'),
(256, 'v_5a9cjdzwp_mqpn86gh', '74.125.212.1', 'Mountain View, California, US', 'Desktop', '2026-06-22 16:03:39', '2026-06-22 16:03:40', 50, '[\"welcome\"]'),
(257, 'v_hxw4158s4_mqs8i9u2', '79.133.41.108', 'Frankfurt am Main, Hesse, DE', 'Windows', '2026-06-24 11:34:58', '2026-06-24 11:35:08', 15, '[\"welcome\"]'),
(258, 'v_vcgp623e9_mqswizpv', '181.94.227.98', 'AsunciÃ³n, Asuncion, PY', 'Windows', '2026-06-24 22:47:18', '2026-06-24 22:52:23', 685, '[\"welcome\",\"my_fear\"]'),
(259, 'v_xfiojibxe_mqu7c7bx', '104.203.151.89', 'Naples, Florida, US', 'Windows', '2026-06-25 20:37:47', '2026-06-25 21:52:23', 5855, '[\"aerophobia\",\"\\u2605 Opened\"]'),
(260, 'v_2com18o7o_mqubjgzs', '175.44.42.70', 'Xiamen, Fujian, CN', 'Windows', '2026-06-25 22:35:25', '2026-06-25 22:35:45', 50, '[\"welcome\"]'),
(261, 'v_tva67dfys_mqve93z3', '74.125.212.1', 'Mountain View, California, US', 'Desktop', '2026-06-26 16:39:03', '2026-06-26 16:39:05', 50, '[\"welcome\"]'),
(262, 'v_8qare7zg8_mqvjx55b', '104.203.151.89', 'Naples, Florida, US', 'Windows', '2026-06-26 19:17:42', '2026-06-26 19:52:51', 630, '[\"aerophobia\",\"\\u2605 Opened\",\"coulrophobia\",\"\\u2605 Opened\"]'),
(263, 'v_1t5egpyr4_mqvk8l7p', '104.203.151.89', 'Naples, Florida, US', 'Windows', '2026-06-26 19:26:37', '2026-06-26 19:37:46', 285, '[\"welcome\"]'),
(264, 'v_ler79ccm1_mqvpaokb', '103.196.9.53', 'New York, New York, US', 'iPhone', '2026-06-26 21:48:16', '2026-06-26 21:48:21', 10, '[\"welcome\"]'),
(265, 'v_iwvb116ts_mqvpaokb', '103.196.9.144', 'New York, New York, US', 'iPhone', '2026-06-26 21:48:21', '2026-06-26 21:48:21', 5, '[\"welcome\"]'),
(266, 'v_rl775ycmn_mqw2pk9f', '95.107.144.135', 'Tirana, Tirana, AL', 'Windows', '2026-06-27 04:03:40', '2026-06-27 04:03:41', 20, '[\"aerophobia\"]'),
(267, 'v_30vht78op_mqw2pjx3', '37.26.80.101', 'Pogradec, KorÃ§Ã« County, AL', 'Android Phone', '2026-06-27 04:03:41', '2026-06-27 04:03:45', 10, '[\"aerophobia\"]'),
(268, 'v_3iykaq7vt_mqw2pskn', '37.26.80.101', 'Pogradec, KorÃ§Ã« County, AL', 'iPhone', '2026-06-27 04:03:51', '2026-06-27 04:03:56', 25, '[\"aerophobia\"]');
