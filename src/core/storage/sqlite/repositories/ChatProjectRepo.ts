import type { Kysely } from 'kysely';
import type { Database as DbSchema } from '../ddl';

/**
 * Chat Project Repository
 * 
 * Manages the `chat_project` table. In the assistant, conversations can be 
 * organized into folders (projects). This repository handles the metadata 
 * for these project containers, including their filesystem paths and archival status.
 * 
 * 对话项目存储库
 * 
 * 管理 `chat_project` 表。在助手中，对话可以被组织到文件夹（项目）中。
 * 此存储库处理这些项目容器的元数据，包括它们在文件系统中的路径和归档状态。
 */
export class ChatProjectRepo {
	constructor(private readonly db: Kysely<DbSchema>) {}

	/**
	 * Checks if a project exists by its unique ID.
	 * 检查项目是否按其唯一 ID 存在。
	 */
	async existsByProjectId(projectId: string): Promise<boolean> {
		const row = await this.db
			.selectFrom('chat_project')
			.select('project_id')
			.where('project_id', '=', projectId)
			.executeTakeFirst();
		return row !== undefined;
	}

	/**
	 * Inserts a new project record.
	 * 插入新的项目记录。
	 */
	async insert(project: {
		project_id: string;
		name: string;
		folder_rel_path: string;
		created_at_ts: number;
		updated_at_ts: number;
		archived_rel_path: string | null;
		meta_json: string | null;
	}): Promise<void> {
		await this.db
			.insertInto('chat_project')
			.values(project)
			.execute();
	}

	/**
	 * Updates an existing project record by its ID.
	 * 通过其 ID 更新现有的项目记录。
	 */
	async updateByProjectId(projectId: string, updates: Partial<Pick<DbSchema['chat_project'], 'name' | 'folder_rel_path' | 'updated_at_ts' | 'archived_rel_path' | 'meta_json'>>): Promise<void> {
		await this.db
			.updateTable('chat_project')
			.set(updates)
			.where('project_id', '=', projectId)
			.execute();
	}

	/**
	 * Upserts a project: updates if it exists, otherwise inserts.
	 * 更新或插入项目：如果存在则更新，否则插入。
	 */
	async upsertProject(params: {
		projectId: string;
		name: string;
		folderRelPath: string;
		createdAtTs: number;
		updatedAtTs: number;
		archivedRelPath?: string | null;
		metaJson?: string | null;
	}): Promise<void> {
		const exists = await this.existsByProjectId(params.projectId);

		if (exists) {
			// Update existing project | 更新现有项目
			await this.updateByProjectId(params.projectId, {
				name: params.name,
				folder_rel_path: params.folderRelPath,
				updated_at_ts: params.updatedAtTs,
				archived_rel_path: params.archivedRelPath ?? null,
				meta_json: params.metaJson ?? null,
			});
		} else {
			// Insert new project | 插入新项目
			await this.insert({
				project_id: params.projectId,
				name: params.name,
				folder_rel_path: params.folderRelPath,
				created_at_ts: params.createdAtTs,
				updated_at_ts: params.updatedAtTs,
				archived_rel_path: params.archivedRelPath ?? null,
				meta_json: params.metaJson ?? null,
			});
		}
	}

	/**
	 * Retrieves project details by ID.
	 * 通过 ID 获取项目详情。
	 */
	async getById(projectId: string): Promise<DbSchema['chat_project'] | null> {
		const row = await this.db
			.selectFrom('chat_project')
			.selectAll()
			.where('project_id', '=', projectId)
			.executeTakeFirst();
		return row ?? null;
	}

	/**
	 * Retrieves a project based on its relative folder path in the vault.
	 * 获取在库中的相对文件夹路径对应的项目。
	 */
	async getByFolderPath(folderRelPath: string): Promise<DbSchema['chat_project'] | null> {
		const row = await this.db
			.selectFrom('chat_project')
			.selectAll()
			.where('folder_rel_path', '=', folderRelPath)
			.executeTakeFirst();
		return row ?? null;
	}

	/**
	 * Lists all projects, optionally including archived ones.
	 * 列出所有项目，可选地包含已归档的项目。
	 */
	async listProjects(includeArchived: boolean = false): Promise<DbSchema['chat_project'][]> {
		let query = this.db.selectFrom('chat_project').selectAll();
		if (!includeArchived) {
			query = query.where('archived_rel_path', 'is', null);
		}
		return query.orderBy('updated_at_ts', 'desc').execute();
	}

	/**
	 * Updates folder paths when a project directory is moved or renamed in Obsidian.
	 * 当 Obsidian 中的项目目录被移动或重命名时，更新文件夹路径。
	 */
	async updatePathsOnMove(
		projectId: string,
		newFolderRelPath: string,
		newArchivedRelPath?: string | null
	): Promise<void> {
		await this.db
			.updateTable('chat_project')
			.set({
				folder_rel_path: newFolderRelPath,
				archived_rel_path: newArchivedRelPath ?? null,
			})
			.where('project_id', '=', projectId)
			.execute();
	}
}
