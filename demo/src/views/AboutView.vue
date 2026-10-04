<template>
    <main class="workspace page-workspace about-page">
        <p class="section-kicker">ABOUT THE SDK</p>
        <h1>SDK 说明</h1>
        <p class="about-lead">
            这个独立 Vue 项目直接引用
            <code>src</code> 中的 SDK 源码，以便及时验证开发中的改动。
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
            <article>
                <span class="summary-label">行为数据</span>
                <strong>PV / Click / Route</strong>
                <p>记录页面访问、用户操作和前端路由变化。</p>
            </article>
            <article>
                <span class="summary-label">错误数据</span>
                <strong>JS / Promise / Resource / Vue</strong>
                <p>捕获运行时、资源加载和 Vue 组件异常。</p>
            </article>
        </div>
    </main>
</template>
