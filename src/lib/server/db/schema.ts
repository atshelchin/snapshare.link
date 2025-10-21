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
