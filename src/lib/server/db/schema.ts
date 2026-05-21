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
		upload_id: text(), // R2 multipart upload ID
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
