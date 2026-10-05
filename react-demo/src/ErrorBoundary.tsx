import {
    Component,
    type ErrorInfo,
    type ReactNode,
} from "react";
import frontendMonitor from "../../src/index.js";

interface ErrorBoundaryProps {
    children: ReactNode;
    onReset: () => void;
}

interface ErrorBoundaryState {
    error: Error | null;
}

export class ErrorBoundary extends Component<
    ErrorBoundaryProps,
    ErrorBoundaryState
> {
    public state: ErrorBoundaryState = {
        error: null,
    };

    public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { error };
    }

    public componentDidCatch(error: Error, info: ErrorInfo): void {
        frontendMonitor.errorBoundary(error, info);
    }

    public render(): ReactNode {
        if (this.state.error) {
            return (
                <div className="boundary-fallback" role="alert">
                    <div>
                        <strong>React 异常已捕获</strong>
                        <span>{this.state.error.message}</span>
                    </div>
                    <button type="button" onClick={this.props.onReset}>
                        恢复组件
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}
