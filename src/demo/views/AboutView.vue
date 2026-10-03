<template>
    <main class="workspace page-workspace about-page">
        <p class="section-kicker">ABOUT THE SDK</p>
        <h1>SDK 说明</h1>
        <p class="about-lead">
            这个 Vue 页面直接使用 <code>src/performance</code> 源码运行，Vite
            负责 TypeScript、Vue SFC 和依赖解析。
        </p>
        <div class="about-grid">
            <article>
                <span class="summary-label">页面指标</span>
                <strong>FP / FCP / LCP / Load</strong>
                <p>观察绘制、内容可见和页面加载完成时间。</p>
            </article>
            <article>
                <span class="summary-label">网络指标</span>
                <strong>Resource / Fetch / XHR</strong>
                <p>记录资源网络阶段以及接口请求耗时和状态。</p>
            </article>
        </div>
    </main>
</template>
