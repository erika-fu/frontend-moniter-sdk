export interface ReportConfig {
    url: string;
    projectName: string;
    appId: string;
    userId: string;
    isImageUpload: boolean;
    batchSize: number;
}

export interface ReportConfigOptions {
    url?: string | undefined;
    projectName?: string | undefined;
    appId?: string | undefined;
    userId?: string | undefined;
    isImageUpload?: boolean | undefined;
    batchSize?: number | undefined;
}

const DEFAULT_CONFIG: Readonly<ReportConfig> = {
    url: "",
    projectName: "",
    appId: "",
    userId: "",
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
    if (options.isImageUpload !== undefined) {
        config.isImageUpload = options.isImageUpload;
    }
    if (options.batchSize !== undefined) {
        config.batchSize = Math.max(0, Math.floor(options.batchSize));
    }
}

export function getReportConfig(): Readonly<ReportConfig> {
    return { ...config };
}

export function resetReportConfig(): void {
    Object.assign(config, DEFAULT_CONFIG);
}

export default config;
