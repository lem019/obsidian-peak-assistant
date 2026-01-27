import { Notice, App } from 'obsidian';
import type { ViewManager } from '@/app/view/ViewManager';
import { SqlJsStore } from './sqljs-adapter/SqlJsStore';
import { BetterSqliteStore } from './better-sqlite3-adapter/BetterSqliteStore';
import type { SqliteDatabase } from './types';
import { Kysely } from 'kysely';
import type { Database as DbSchema } from './ddl';
import type { MyPluginSettings } from '@/app/settings/types';
import path from 'path';

/**
 * @file DatabaseHealthVerifier.ts
 * @description 数据库运行状况验证器，用于确保存储层的可靠性。
 * 
 * ## 核心职能
 * 本文件提供了一套完整的自动化测试套件，用于验证不同环境下的 SQLite 后端是否工作正常。它会执行以下任务：
 * 1. **结构验证 (DDL)**：测试是否能正确创建表、索引和约束。
 * 2. **基础操作 (CRUD)**：验证插入、查询、更新和删除逻辑的准确性。
 * 3. **原子性测试 (Transactions)**：确保事务提交和回滚（Rollback）机制在原生环境和 WASM 环境下表现一致。
 * 4. **性能与兼容性挂念**：测试复杂的 JOIN 关联查询和聚合计算。
 * 
 * ## 在项目中的角色
 * 它是存储层的“质量守门员”。当插件在新的平台（如安卓手机或 ARM 架构的 Mac）启动遇到问题时，可以通过该验证器快速排查是数据库引擎的问题还是代码逻辑的问题。
 * 
 * ## 生活化类比
 * 就像在正式入住新房前，先打开所有的水龙头检查是否漏水、拉一遍电闸看是否跳闸一样。它是在生产环境启用数据库前的一次“试运行”。
 */

/**
 * Test database schema for tables created during testing.
 * These tables are not part of the main application schema.
 * 
 * 用于测试期间创建表的测试数据库架构。这些表不属于主应用程序架构。
 */
interface TestDatabase {
	test_table: {
		id: string;
		name: string;
		value: number | null;
		created_at: number;
	};
	test_txn: {
		id: string;
		value: string;
	};
	test_constraints: {
		id: string;
		unique_field: string;
		not_null_field: string;
	};
	authors: {
		id: string;
		name: string;
	};
	books: {
		id: string;
		title: string;
		author_id: string;
	};
}

/**
 * Mock repository for testing DDL and database operations.
 * Uses Kysely's type-safe API with test schema.
 * 
 * 用于测试 DDL 和数据库操作的模拟存储库。使用 Kysely 的类型安全 API 和测试架构。
 */
class TestRepository {
	constructor(private readonly db: Kysely<TestDatabase>) {}

	/**
	 * Creates a test table and index to verify DDL capabilities.
	 * 创建测试表和索引以验证 DDL 功能。
	 */
	async createTestTable(): Promise<void> {
		// Create a simple test table to demonstrate DDL capabilities
		await this.db.schema
			.createTable('test_table')
			.addColumn('id', 'text', (col) => col.primaryKey())
			.addColumn('name', 'text', (col) => col.notNull())
			.addColumn('value', 'integer')
			.addColumn('created_at', 'integer', (col) => col.notNull())
			.execute();

		// Add an index to demonstrate DDL index creation
		await this.db.schema
			.createIndex('idx_test_table_name')
			.on('test_table')
			.column('name')
			.execute();
	}

	/**
	 * Basic presence check for test records.
	 * 测试记录的基本存在性检查。
	 */
	async existsById(id: string): Promise<boolean> {
		const row = await this.db
			.selectFrom('test_table')
			.select('id')
			.where('id', '=', id)
			.executeTakeFirst();
		return row !== undefined;
	}

	/**
	 * Upsert operation for the test table.
	 * 测试表的更新或插入操作。
	 */
	async upsert(record: { id: string; name: string; value?: number }): Promise<void> {
		if (!record.id) {
			throw new Error('id is required for test_table.upsert');
		}

		const exists = await this.existsById(record.id);

		if (exists) {
			await this.db
				.updateTable('test_table')
				.set({
					name: record.name,
					value: record.value ?? null,
				})
				.where('id', '=', record.id)
				.execute();
		} else {
			await this.db
				.insertInto('test_table')
				.values({
					id: record.id,
					name: record.name,
					value: record.value ?? null,
					created_at: Date.now(),
				})
				.execute();
		}
	}

	async selectById(id: string): Promise<any> {
		return await this.db
			.selectFrom('test_table')
			.selectAll()
			.where('id', '=', id)
			.executeTakeFirst();
	}

	async deleteById(id: string): Promise<void> {
		await this.db
			.deleteFrom('test_table')
			.where('id', '=', id)
			.execute();
	}
}

/**
 * Orchestrates a complete database health verification across all supported backends.
 * It opens each engine type, runs comprehensive tests, and reports the results to the user.
 * 
 * 编排跨所有支持后端的完整数据库运行状况验证。它打开每种引擎类型，运行全面测试，
 * 并向用户报告结果。
 */
export async function verifyDatabaseHealth(app: App, settings: MyPluginSettings): Promise<void> {
	const testResults: string[] = [];
	let totalTests = 0;
	let passedTests = 0;

	try {
		// Get storage folder from settings
		const storageFolder = settings.dataStorageFolder?.trim();
		const basePath = (app.vault.adapter as any)?.basePath;

		if (!basePath) {
			throw new Error('Cannot determine vault base path for database testing');
		}

		// Test configurations: [backend, dbPath, description]
		const testConfigs = [
			['sql.js', ':memory:', 'SQL.js in-memory database'] as const,
			['sql.js', path.join(basePath, storageFolder, 'test-health-sqljs.db'), 'SQL.js file-based database'] as const,
			['better-sqlite3', path.join(basePath, storageFolder, 'test-health-better.db'), 'Better-SQLite3 file-based database'] as const,
		];

		for (const [backend, dbPath, description] of testConfigs) {
			try {
				let testDb: SqliteDatabase;

				if (backend === 'sql.js') {
					testDb = await SqlJsStore.open({ dbFilePath: dbPath });
				} else if (backend === 'better-sqlite3') {
					const result = await BetterSqliteStore.open({ dbFilePath: dbPath, app });
					testDb = result.store;
				} else {
					throw new Error(`Unknown backend: ${backend}`);
				}

				testResults.push(`✅ ${description} creation: PASSED`);

				// Run comprehensive tests on this database type | 对此数据库类型运行全面测试
				const testResult = await verifyOneDatabaseType(testDb);
				testResults.push(...testResult.results);
				passedTests += testResult.passedTests;
				totalTests += testResult.totalTests;

				// Close test database | 关闭测试数据库
				testDb.close();

				// Clean up file-based test databases | 清理基于文件的测试数据库
				if (dbPath !== ':memory:') {
					try {
						const fs = require('fs');
						if (fs.existsSync(dbPath)) {
							fs.unlinkSync(dbPath);
						}
					} catch (cleanupError) {
						console.warn(`Failed to cleanup test database ${dbPath}:`, cleanupError);
					}
				}

			} catch (error) {
				testResults.push(`❌ ${description} test: FAILED - ${error}`);
			}
		}

		// Summary | 总结
		const successRate = Math.round((passedTests / totalTests) * 100);
		const summary = `\nComprehensive Database Health Verification Complete\nPassed: ${passedTests}/${totalTests} (${successRate}%)\n\n`;

		if (passedTests === totalTests) {
			new Notice('✅ All database backends are healthy!', 3000);
		} else if (successRate >= 80) {
			new Notice('⚠️ Most database backends are healthy. Check console for details.', 5000);
		} else {
			new Notice('❌ Database backends have significant issues. Check console for details.', 5000);
		}

		console.log(summary + testResults.join('\n'));

	} catch (error) {
		console.error('[Database Verification] Unexpected error:', error);
		new Notice('❌ Database verification failed with unexpected error. Check console.', 5000);
	}
}

/**
 * Runs a suite of functional tests against a single database instance.
 * Covers DDL, single-row CRUD, transactions with rollback, constraints, and relational joins.
 * 
 * 针对单个数据库实例运行一组功能性测试。涵盖 DDL、单行 CRUD、带回滚的事务、约束
 * 和关联连接。
 */
export async function verifyOneDatabaseType(testDb: SqliteDatabase): Promise<{
	results: string[];
	passedTests: number;
	totalTests: number;
}> {
	let testResults: string[] = [];
	let passedTests = 0;
	let totalTests = 0;

	try {

		// Test 1: DDL - Table creation | DDL - 表创建
		totalTests++;
		try {
			if (!testDb) throw new Error('Test database not available');

			const testKysely = testDb.kysely<TestDatabase>();
			const testRepo = new TestRepository(testKysely);

			// Test CREATE TABLE DDL | 测试创建表 DDL
			await testRepo.createTestTable();

			// Verify table existence via master catalog | 通过主目录验证表是否存在
			const tableStmt = testDb.prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?');
			const tableCheck = tableStmt.get('table', 'test_table');

			if (!tableCheck) {
				throw new Error('Table test_table was not created');
			}

			// Verify index was created | 验证索引是否已创建
			const indexStmt = testDb.prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?');
			const indexCheck = indexStmt.get('index', 'idx_test_table_name');

			if (!indexCheck) {
				throw new Error('Index idx_test_table_name was not created');
			}

			testResults.push('✅ DDL Table and index creation: PASSED');
			passedTests++;
		} catch (error) {
			testResults.push(`❌ DDL Table and index creation: FAILED - ${error}`);
		}

		// Test 3: UPSERT operations | UPSERT 操作
		totalTests++;
		try {
			if (!testDb) throw new Error('Test database not available');

			const testKysely = testDb.kysely<TestDatabase>();
			const testRepo = new TestRepository(testKysely);

			// Test INSERT via upsert (new record) | 通过 upsert 测试插入（新记录）
			const testId = 'test-record-' + Date.now();
			await testRepo.upsert({
				id: testId,
				name: 'Test Record',
				value: 100,
			});

			// Verify insert worked | 验证插入是否成功
			const inserted = await testRepo.selectById(testId);
			if (!inserted || inserted.name !== 'Test Record' || inserted.value !== 100) {
				throw new Error('UPSERT insert failed');
			}

			// Test UPDATE via upsert (existing record) | 通过 upsert 测试更新（现有记录）
			await testRepo.upsert({
				id: testId,
				name: 'Updated Test Record',
				value: 150,
			});

			// Verify update worked | 验证更新是否成功
			const updated = await testRepo.selectById(testId);
			if (!updated || updated.name !== 'Updated Test Record' || updated.value !== 150) {
				throw new Error('UPSERT update failed');
			}

			testResults.push('✅ UPSERT operations: PASSED');
			passedTests++;
		} catch (error) {
			testResults.push(`❌ UPSERT operations: FAILED - ${error}`);
		}

		// Test 4: Transaction support | 事务支持
		totalTests++;
		try {
			if (!testDb) throw new Error('Test database not available');

			const testKysely = testDb.kysely<TestDatabase>();

			// Create the table for transaction testing | 创建用于事务测试的表
			await testKysely.schema
				.createTable('test_txn')
				.addColumn('id', 'text', (col) => col.primaryKey())
				.addColumn('value', 'text')
				.execute();

			// Test transaction with commit using Kysely | 使用 Kysely 测试带提交的事务
			await testKysely.transaction().execute(async (tx) => {
				const testId = 'txn-commit-' + Date.now();

				await tx
					.insertInto('test_txn')
					.values({
						id: testId,
						value: 'committed',
					})
					.execute();

				// Verify within transaction | 在事务内验证
				const result = await tx
					.selectFrom('test_txn')
					.select('value')
					.where('id', '=', testId)
					.executeTakeFirst();

				if (!result || result.value !== 'committed') {
					throw new Error('Transaction commit failed');
				}
			});

			// Verify data was committed (outside transaction) | 验证数据是否已提交（事务外）
			const committedResult = await testKysely
				.selectFrom('test_txn')
				.select('value')
				.where('value', '=', 'committed')
				.executeTakeFirst();

			if (!committedResult) {
				throw new Error('Transaction data was not committed');
			}

			testResults.push('✅ Transaction support: PASSED');
			passedTests++;
		} catch (error) {
			testResults.push(`❌ Transaction support: FAILED - ${error}`);
		}

		// Test 5: Transaction rollback | 事务回滚
		totalTests++;
		try {
			if (!testDb) throw new Error('Test database not available');

			const testKysely = testDb.kysely<TestDatabase>();

			try {
				await testKysely.transaction().execute(async (tx) => {
					const testId = 'txn-rollback-' + Date.now();

					await tx
						.insertInto('test_txn')
						.values({
							id: testId,
							value: 'should-be-rolled-back',
						})
						.execute();

					// Verify within transaction | 在事务内验证
					const result = await tx
						.selectFrom('test_txn')
						.select('value')
						.where('id', '=', testId)
						.executeTakeFirst();

					if (!result) {
						throw new Error('Transaction insert failed');
					}

					// This should cause rollback | 这应该引发回滚
					throw new Error('Intentional rollback test');
				});
			} catch (error) {
				// Expected to fail due to intentional rollback | 预期由于故意回滚而失败
				if (error.message !== 'Intentional rollback test') {
					throw error;
				}
			}

			// Verify data was rolled back (should not exist) | 验证数据是否已回滚（不应存在）
			const rolledBackResult = await testKysely
				.selectFrom('test_txn')
				.select('value')
				.where('value', '=', 'should-be-rolled-back')
				.executeTakeFirst();

			if (rolledBackResult) {
				throw new Error('Transaction data was not rolled back');
			}

			testResults.push('✅ Transaction rollback: PASSED');
			passedTests++;
		} catch (error) {
			testResults.push(`❌ Transaction rollback: FAILED - ${error}`);
		}

		// Test 6: Error handling | 错误处理
		totalTests++;
		try {
			if (!testDb) throw new Error('Test database not available');

			const testKysely = testDb.kysely<TestDatabase>();
			const testRepo = new TestRepository(testKysely);

			// Test invalid UPSERT operations | 测试无效的 UPSERT 操作
			try {
				await testRepo.upsert({ name: 'invalid' } as any); // Missing required id | 缺少必需的 id
				throw new Error('Should have failed due to missing id');
			} catch (error) {
				if (error.message.includes('id is required')) {
					testResults.push('✅ Error handling: PASSED');
					passedTests++;
				} else {
					throw error;
				}
			}
		} catch (error) {
			testResults.push(`❌ Error handling: FAILED - ${error}`);
		}

		// Test 7: SQL constraints and indexes | SQL 约束和索引
		totalTests++;
		try {
			if (!testDb) throw new Error('Test database not available');

			const testKysely = testDb.kysely<TestDatabase>();

			// Create table with constraints using Kysely | 使用 Kysely 创建带有约束的表
			await testKysely.schema
				.createTable('test_constraints')
				.addColumn('id', 'text', (col) => col.primaryKey())
				.addColumn('unique_field', 'text', (col) => col.unique())
				.addColumn('not_null_field', 'text', (col) => col.notNull())
				.execute();

			// Test NOT NULL constraint | 测试 NOT NULL 约束
			try {
				await testKysely
					.insertInto('test_constraints')
					.values({
						id: 'test-1',
						unique_field: 'unique1',
						not_null_field: null as any, // This should fail | 这应该失败
					})
					.execute();
				throw new Error('NOT NULL constraint not enforced');
			} catch (error) {
				// Expected to fail due to NOT NULL constraint | 预期由于 NOT NULL 约束而失败
				if (!error.message.includes('NOT NULL') && !error.message.includes('null value')) {
					throw error;
				}
			}

			// Test UNIQUE constraint | 测试 UNIQUE 约束
			await testKysely
				.insertInto('test_constraints')
				.values({
					id: 'test-1',
					unique_field: 'unique1',
					not_null_field: 'not null value',
				})
				.execute();

			try {
				await testKysely
					.insertInto('test_constraints')
					.values({
						id: 'test-2',
						unique_field: 'unique1', // This should fail (duplicate) | 这应该失败（重复）
						not_null_field: 'another value',
					})
					.execute();
				throw new Error('UNIQUE constraint not enforced');
			} catch (error) {
				// Expected to fail due to UNIQUE constraint | 预期由于 UNIQUE 约束而失败
				if (!error.message.includes('UNIQUE') && !error.message.includes('constraint')) {
					throw error;
				}
			}

			testResults.push('✅ SQL constraints and indexes: PASSED');
			passedTests++;
		} catch (error) {
			testResults.push(`❌ SQL constraints and indexes: FAILED - ${error}`);
		}

		// Test 8: Complex queries and joins | 复杂查询和连接
		totalTests++;
		try {
			if (!testDb) throw new Error('Test database not available');

			const testKysely = testDb.kysely<TestDatabase>();

			// Create related tables for join testing | 创建用于连接测试的相关表
			await testKysely.schema
				.createTable('authors')
				.addColumn('id', 'text', (col) => col.primaryKey())
				.addColumn('name', 'text', (col) => col.notNull())
				.execute();

			await testKysely.schema
				.createTable('books')
				.addColumn('id', 'text', (col) => col.primaryKey())
				.addColumn('title', 'text', (col) => col.notNull())
				.addColumn('author_id', 'text', (col) => col.references('authors.id'))
				.execute();

			// Insert test data | 插入测试数据
			await testKysely
				.insertInto('authors')
				.values([
					{ id: 'author-1', name: 'Author One' },
					{ id: 'author-2', name: 'Author Two' },
				])
				.execute();

			await testKysely
				.insertInto('books')
				.values([
					{ id: 'book-1', title: 'Book One', author_id: 'author-1' },
					{ id: 'book-2', title: 'Book Two', author_id: 'author-1' },
					{ id: 'book-3', title: 'Book Three', author_id: 'author-2' },
				])
				.execute();

			// Test JOIN query | 测试 JOIN 查询
			const booksWithAuthors = await testKysely
				.selectFrom('books')
				.innerJoin('authors', 'books.author_id', 'authors.id')
				.select([
					'books.id as book_id',
					'books.title as book_title',
					'authors.name as author_name',
				])
				.execute();

			if (booksWithAuthors.length !== 3) {
				throw new Error('JOIN query returned incorrect number of results');
			}

			// Test aggregation query | 测试聚合查询
			const authorBookCounts = await testKysely
				.selectFrom('books')
				.innerJoin('authors', 'books.author_id', 'authors.id')
				.select([
					'authors.name',
					testKysely.fn.count('books.id').as('book_count'),
				])
				.groupBy(['authors.id', 'authors.name'])
				.execute();

			if (authorBookCounts.length !== 2) {
				throw new Error('Aggregation query returned incorrect number of results');
			}

			testResults.push('✅ Complex queries and joins: PASSED');
			passedTests++;
		} catch (error) {
			testResults.push(`❌ Complex queries and joins: FAILED - ${error}`);
		}

	} catch (error) {
		console.error('[Database Verification] Unexpected error:', error);
		testResults.push(`❌ Database verification failed: ${error}`);
	}

	return {
		results: testResults,
		passedTests,
		totalTests,
	};
}