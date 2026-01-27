/**
 * @file Stopwatch.ts
 * @description 秒表工具类，用于测量和记录带标签的时间段
 * 
 * Stopwatch utility for measuring and logging elapsed time with labeled segments.
 * 
 * Usage: （使用示例）
 * ```typescript
 * const sw = new Stopwatch('Operation');
 * sw.start('step1');
 * // ... do work ...
 * sw.stop();
 * sw.start('step2');
 * // ... do work ...
 * sw.stop();
 * sw.print(); // Prints all segments with timing information
 * ```
 */
export class Stopwatch {
	private segments: Array<{ label: string; startTime: number; endTime?: number; duration?: number }> = [];
	private currentSegment: { label: string; startTime: number } | null = null;
	private readonly name: string;

	constructor(name: string = 'Stopwatch') {
		this.name = name;
	}

	/**
	 * Start a new timing segment with the given label.
	 * If a segment is already running, it will be stopped first.
	 * 
	 * 启动一个新的计时段落
	 * 如果已有段落在运行，会先停止它
	 */
	start(label: string): void {
		// Stop current segment if running
		if (this.currentSegment) {
			this.stop();
		}

		const startTime = Date.now();
		this.currentSegment = { label, startTime };
	}

	/**
	 * Stop the current timing segment.
	 * If no segment is running, this is a no-op.
	 * 
	 * 停止当前计时段落
	 * 如果没有段落在运行，此操作不执行任何事情
	 */
	stop(): void {
		if (!this.currentSegment) {
			return;
		}

		const endTime = Date.now();
		const duration = endTime - this.currentSegment.startTime;
		this.segments.push({
			label: this.currentSegment.label,
			startTime: this.currentSegment.startTime,
			endTime,
			duration,
		});

		this.currentSegment = null;
	}

	/**
	 * Get the total elapsed time from the first segment start to now (or last segment end).
	 * 获取从第一个段落开始到现在（或最后一个段落结束）的总经过时间
	 */
	getTotalElapsed(): number {
		if (this.segments.length === 0) {
			return 0;
		}

		const firstStart = this.segments[0].startTime;
		const lastEnd = this.currentSegment
			? Date.now()
			: (this.segments[this.segments.length - 1].endTime ?? Date.now());

		return lastEnd - firstStart;
	}

	/**
	 * Print all timing segments to console.
	 * Format: [Stopwatch: name] label: duration ms (total: X ms)
	 * 
	 * 将所有计时段落输出到控制台
	 * 格式：[Stopwatch: name] label: duration ms (total: X ms)
	 */
	print(debug: boolean = true): void {
		const total = this.getTotalElapsed();
		const lines: string[] = [];

		lines.push(`[${this.name}] Total: ${total.toFixed(2)} ms`);

		for (const segment of this.segments) {
			const duration = segment.duration ?? 0;
			lines.push(`  - ${segment.label}: ${duration.toFixed(2)} ms`);
		}

		// If there's a current running segment, show it
		if (this.currentSegment) {
			const runningDuration = Date.now() - this.currentSegment.startTime;
			lines.push(`  - ${this.currentSegment.label}: ${runningDuration.toFixed(2)} ms (running)`);
		}

		if (debug) {
			console.debug(lines.join('\n'));
		} else {
			console.log(lines.join('\n'));
		}
	}

	/**
	 * Get a formatted string with all timing information.
	 */
	toString(): string {
		const total = this.getTotalElapsed();
		const lines: string[] = [];

		lines.push(`[${this.name}] Total: ${total.toFixed(2)} ms`);

		for (const segment of this.segments) {
			const duration = segment.duration ?? 0;
			lines.push(`  - ${segment.label}: ${duration.toFixed(2)} ms`);
		}

		if (this.currentSegment) {
			const runningDuration = Date.now() - this.currentSegment.startTime;
			lines.push(`  - ${this.currentSegment.label}: ${runningDuration.toFixed(2)} ms (running)`);
		}

		return lines.join('\n');
	}

	/**
	 * Reset the stopwatch, clearing all segments.
	 */
	reset(): void {
		this.segments = [];
		this.currentSegment = null;
	}
}
