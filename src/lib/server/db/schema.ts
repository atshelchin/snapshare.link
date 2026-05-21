import { sqliteTable, integer, text, index } from 'drizzle-orm/sqlite-core';
export const users = sqliteTable('users', {
	id: integer(),
	name: text()
});

export const files = sqliteTable(
	'files',
	{
		channel_id: text(),
		file_key: text().primaryKey(),
		file_name: text(),
		file_type: text(),
		file_size: integer(),
		uploader_hash_ip: text(),
		created_at: integer()
	},
	(table) => [
		index('channel_id_idx').on(table.channel_id),
		index('uploader_hash_ip_idx').on(table.uploader_hash_ip),
		index('created_at_idx').on(table.created_at)
	]
);

// 付费存储文件（Data Vault - 30天，任意大小）
export const paidFiles = sqliteTable(
	'paid_files',
	{
		file_key: text().primaryKey(),
		order_id: text(), // nanoid
		original_name: text(), // 用户原始文件名（加密前）
		payment_address: text(), // 收款地址
		private_key: text(), // 收款地址私钥 (hex), 用于归集
		channel_id: text().notNull(),
		file_name: text().notNull(),
		file_size: integer().notNull(), // 原始文件大小（字节）
		encrypted: integer().notNull().default(0), // 0=明文 1=加密
		payment_tx: text(), // 链上交易哈希
		payment_amount: text(), // 支付金额 (USDC, 如 "4.50")
		download_price: text(), // 下载价格 (USDC), 上传价格的 1/10, 最低 0.01
		upload_id: text(), // legacy, unused
		upload_status: text().notNull().default('pending'), // pending | uploading | completed | failed
		parts_total: integer().default(0),
		parts_done: integer().default(0),
		uploader_hash_ip: text(),
		swept: integer().notNull().default(0), // 0=未归集 1=已归集
		expires_at: integer().notNull(), // 30天后的时间戳
		created_at: integer().notNull()
	},
	(table) => [
		index('paid_channel_id_idx').on(table.channel_id),
		index('paid_upload_status_idx').on(table.upload_status),
		index('paid_expires_at_idx').on(table.expires_at)
	]
);

// 下载令牌：付费后获取 24 小时有效的下载权限
export const downloadTokens = sqliteTable(
	'download_tokens',
	{
		token: text().primaryKey(), // nanoid
		file_key: text().notNull(), // paid_files.file_key
		payment_tx: text(), // 下载付款链上交易
		payment_address: text(), // 收款地址
		private_key: text(), // 收款私钥
		payment_amount: text(), // 支付金额
		downloads_used: integer().notNull().default(0),
		downloads_max: integer().notNull().default(3), // 最多下载次数
		expires_at: integer().notNull(), // 24h 后过期
		created_at: integer().notNull()
	},
	(table) => [
		index('dt_file_key_idx').on(table.file_key),
		index('dt_expires_at_idx').on(table.expires_at)
	]
);
