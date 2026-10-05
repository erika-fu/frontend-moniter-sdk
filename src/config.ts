export interface ReportConfig {
    url: string;
    projectName: string;
    appId: string;
    userId: string;
    release: string;
    isImageUpload: boolean;
    batchSize: number;
}

export interface ReportConfigOptions {
    url?: string | undefined;
    projectName?: string | undefined;
    appId?: string | undefined;
    userId?: string | undefined;
    release?: string | undefined;
    isImageUpload?: boolean | undefined;
    batchSize?: number | undefined;
}

const DEFAULT_CONFIG: Readonly<ReportConfig> = {
    url: "",
    projectName: "",
    appId: "",
    userId: "",
    release: "",
    isImageUpload: false,
    batchSize: 5,
};

const config: ReportConfig = { ...DEFAULT_CONFIG };

/**
 * 更新上报配置。未提供的字段保持原值。
 */
export function setConfig(options: ReportConfigOptions = {}): void {
    if (options.url !== undefined) {
        config.url = options.url;
    }
    if (options.projectName !== undefined) {
        config.projectName = options.projectName;
    }
    if (options.appId !== undefined) {
        config.appId = options.appId;
    }
    if (options.userId !== undefined) {
        config.userId = options.userId;
    }
    if (options.release !== undefined) {
        config.release = options.release;
    }
    if (options.isImageUpload !== undefined) {
        config.isImageUpload = options.isImageUpload;
    }
    if (options.batchSize !== undefined) {
        config.batchSize = Math.max(0, Math.floor(options.batchSize));
    }
}

/**
 * 返回当前上报配置的只读副本，避免调用方直接修改内部状态。
 */
export function getReportConfig(): Readonly<ReportConfig> {
    return { ...config };
}

/**
 * 将上报配置恢复为 SDK 默认值。
 */
export function resetReportConfig(): void {
    Object.assign(config, DEFAULT_CONFIG);
}

export default config;
