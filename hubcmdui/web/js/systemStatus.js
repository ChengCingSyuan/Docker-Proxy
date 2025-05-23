/**
 * 系统状态管理模块
 */

// --- 新增：用于缓存最新的系统状态数据 ---
let currentSystemData = null;
let DEBUG_MODE = false; // 控制是否输出调试信息

// 简单的日志工具
const logger = {
    debug: function(...args) {
        if (DEBUG_MODE) {
            // console.log('[systemStatus:DEBUG]', ...args);
        }
    },
    log: function(...args) {
        // console.log('[systemStatus]', ...args);
    },
    warn: function(...args) {
        // console.warn('[systemStatus]', ...args);
    },
    error: function(...args) {
        // console.error('[systemStatus]', ...args);
    },
    // 开启或关闭调试模式
    setDebug: function(enabled) {
        DEBUG_MODE = !!enabled;
        // console.log(`[systemStatus] 调试模式已${DEBUG_MODE ? '开启' : '关闭'}`);
    }
};

// 刷新系统状态
async function refreshSystemStatus() {
    // logger.log('刷新系统状态...');
    
    showSystemStatusLoading(); // 显示表格/活动列表的加载状态
    showDashboardLoading(); // 显示仪表盘卡片的加载状态
    
    try {
        // 并行获取Docker状态和系统资源信息
        // logger.log('获取Docker状态和系统资源信息');
        const [dockerResponse, resourcesResponse] = await Promise.all([
            fetch('/api/docker/status').catch(err => { /* logger.error('Docker status fetch failed:', err); */ return null; }), // 添加 catch
            fetch('/api/system-resources').catch(err => { /* logger.error('System resources fetch failed:', err); */ return null; }) // 添加 catch
        ]);
        
        // logger.debug('API响应结果:', { dockerOk: dockerResponse?.ok, resourcesOk: resourcesResponse?.ok });
        
        let dockerDataArray = null; // 用于存放容器数组
        let isDockerServiceRunning = false; // 用于判断 Docker 服务本身是否响应
        
        if (dockerResponse && dockerResponse.ok) {
            try {
                // 假设 API 直接返回容器数组
                dockerDataArray = await dockerResponse.json(); 
                // logger.debug('Docker数据:', JSON.stringify(dockerDataArray));
                
                // 只有当返回的是数组，且状态属性表明 Docker 正在运行时，才认为 Docker 服务是运行的
                if (Array.isArray(dockerDataArray)) {
                    // 检查特殊错误标记，这可能会在 dockerService.js 中添加
                    const hasDockerUnavailableError = dockerDataArray.length === 1 && 
                                                      dockerDataArray[0] && 
                                                      dockerDataArray[0].error === 'DOCKER_UNAVAILABLE';
                    
                    const hasContainerListError = dockerDataArray.length === 1 && 
                                                   dockerDataArray[0] && 
                                                   dockerDataArray[0].error === 'CONTAINER_LIST_ERROR';

                    // 只有在没有这两种特定错误时，才认为 Docker 服务正常
                    isDockerServiceRunning = !hasDockerUnavailableError && !hasContainerListError;
                    
                    // logger.debug(`Docker服务状态: ${isDockerServiceRunning ? '运行中' : '未运行'}, 错误状态:`, 
                        // { hasDockerUnavailableError, hasContainerListError });
                } else {
                    // logger.warn('Docker数据不是数组:', typeof dockerDataArray);
                    isDockerServiceRunning = false;
                }
            } catch (jsonError) {
                // logger.error('解析Docker数据失败:', jsonError);
                dockerDataArray = []; // 解析失败视为空数组
                isDockerServiceRunning = false; // JSON 解析失败，认为服务有问题
            }
        } else {
            // logger.warn('获取Docker状态失败');
            dockerDataArray = []; // 请求失败视为空数组
            isDockerServiceRunning = false; // 请求失败，认为服务未运行
        }
        
        let resourcesData = null;
        if (resourcesResponse && resourcesResponse.ok) {
            try {
                // --- 添加日志：打印原始响应文本 ---
                const resourcesText = await resourcesResponse.text();
                // logger.debug('原始系统资源响应:', resourcesText);
                resourcesData = JSON.parse(resourcesText); // 解析文本
                // logger.debug('解析后的系统资源数据:', resourcesData);
            } catch (jsonError) {
                // logger.error('解析系统资源数据失败:', jsonError);
                resourcesData = { cpu: null, memory: null, diskSpace: null }; 
            }
        } else {
            // logger.warn(`获取系统资源失败, 状态: ${resourcesResponse?.status}`);
            resourcesData = { cpu: null, memory: null, diskSpace: null };
        }
        
        // 合并数据
        const combinedData = {
            // 直接使用 isDockerServiceRunning 判断状态
            dockerStatus: isDockerServiceRunning ? 'running' : 'stopped', 
            // 直接使用获取到的容器数组
            dockerContainers: Array.isArray(dockerDataArray) ? dockerDataArray : [], 
            cpu: resourcesData?.cpu || { cores: 0, usage: undefined },
            memory: resourcesData?.memory || { total: 0, free: 0, used: 0, usedPercentage: undefined },
            disk: resourcesData?.disk || { size: '未知', used: '未知', available: '未知', percent: '未知' },
            diskSpace: resourcesData?.diskSpace || { total: 0, free: 0, used: 0, usedPercentage: undefined },
            // recentActivities 的逻辑保持不变，如果需要从 docker 数据生成，需要调整
            // 暂时假设 recentActivities 来源于其他地方或保持为空
             recentActivities: [] // 确保是空数组，除非有其他来源
        };
        
        // --- 修改：将合并后的数据存入缓存 --- 
        currentSystemData = combinedData; // 缓存数据
        
        // logger.debug('合并后的状态数据:', currentSystemData);
        updateSystemStatusUI(currentSystemData);
        // logger.log('系统状态加载完成');
        
        // 只在仪表盘页面（且登录框未显示时）才显示成功通知
        const adminContainer = document.querySelector('.admin-container');
        const loginModal = document.getElementById('loginModal');
        const isDashboardVisible = adminContainer && window.getComputedStyle(adminContainer).display !== 'none';
        const isLoginHidden = !loginModal || window.getComputedStyle(loginModal).display === 'none';
        
        if (isDashboardVisible && isLoginHidden) {
            // 显示成功通知
            Swal.fire({
                icon: 'success',
                title: '刷新成功',
                text: '系统状态信息已更新',
                toast: true,
                position: 'top-end',
                showConfirmButton: false,
                timer: 3000
            });
        }
    } catch (error) {
        // logger.error('刷新系统状态出错:', error);
        showSystemStatusError(error.message);
        showDashboardError(error.message);
        
        // 只在仪表盘页面（且登录框未显示时）才显示错误通知
        const adminContainer = document.querySelector('.admin-container');
        const loginModal = document.getElementById('loginModal');
        const isDashboardVisible = adminContainer && window.getComputedStyle(adminContainer).display !== 'none';
        const isLoginHidden = !loginModal || window.getComputedStyle(loginModal).display === 'none';
        
        if (isDashboardVisible && isLoginHidden) {
            // 显示错误通知
            Swal.fire({
                icon: 'error',
                title: '刷新失败',
                text: error.message,
                toast: true,
                position: 'top-end',
                showConfirmButton: false,
                timer: 5000
            });
        }
    }
}

// 显示系统状态错误
function showSystemStatusError(message) {
    // console.error('系统状态错误:', message);
    
    // 更新Docker容器表格状态为错误
    const containerBody = document.getElementById('dockerContainersBody');
    if (containerBody) {
        containerBody.innerHTML = `
            <tr>
                <td colspan="5" class="text-center">
                    <div class="error-container">
                        <i class="fas fa-exclamation-triangle text-danger fa-2x"></i>
                        <p class="mt-2">无法加载Docker容器信息</p>
                        <small class="text-muted">${message}</small>
                    </div>
                </td>
            </tr>
        `;
    }
    
    // 更新活动表格状态为错误
    const activitiesTable = document.getElementById('recentActivitiesTable');
    if (activitiesTable) {
        const tbody = activitiesTable.querySelector('tbody') || activitiesTable;
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="3" class="text-center">
                        <div class="error-container">
                            <i class="fas fa-exclamation-triangle text-danger fa-2x"></i>
                            <p class="mt-2">无法加载系统活动信息</p>
                            <small class="text-muted">${message}</small>
                        </div>
                    </td>
                </tr>
            `;
        }
    }
}

// 更新系统状态UI
function updateSystemStatusUI(data) {
    // 移除详细的数据日志
    // console.log('[systemStatus] Updating UI with data:', data);
    
    if (!data) {
        showSystemStatusError('无法获取系统状态数据');
        showDashboardError('无法获取系统状态数据');
        return;
    }
    
    // 更新Docker状态指示器
    updateDockerStatus(data.dockerStatus === 'running'); 
    
    // 更新仪表盘卡片
    updateDashboardCards(data);
    
    // 更新活动列表 
    updateActivitiesTable(Array.isArray(data.recentActivities) ? data.recentActivities : []);
    
    // --- 调用 dockerManager 来渲染容器表格 (确保调用) --- 
    if (typeof dockerManager !== 'undefined' && dockerManager.renderContainersTable) {
        dockerManager.renderContainersTable(data.dockerContainers, data.dockerStatus);
    } else {
        // 如果 dockerManager 不可用，提供一个简单错误信息
        const containerBody = document.getElementById('dockerStatusTableBody');
        if (containerBody) {
            containerBody.innerHTML = `
                <tr>
                    <td colspan="5" class="text-center text-danger">
                         <i class="fas fa-exclamation-triangle me-2"></i> 无法加载容器管理组件
                    </td>
                </tr>
            `;
        }
    }
    
    // 更新存储使用进度条
    try {
        // 使用可选链和确保 parseDiskSpace 返回有效对象
        const diskData = parseDiskSpace(data.diskSpace);
        // console.log('[systemStatus] Parsed disk data for progress bar:', diskData);
        if (diskData && typeof diskData.usagePercent === 'number') { 
            updateProgressBar('diskSpaceProgress', diskData.usagePercent);
            // console.log(`[systemStatus] Updated disk progress bar with: ${diskData.usagePercent}%`);
        } else {
            updateProgressBar('diskSpaceProgress', 0); // 出错或无数据时归零
             // console.log('[systemStatus] Disk data invalid or missing usagePercent for progress bar.');
        }
    } catch (e) {
        // console.warn('[systemStatus] Failed to update disk progress bar:', e);
        updateProgressBar('diskSpaceProgress', 0); // 出错时归零
    }
    
    // 更新内存使用进度条
    try {
        // 使用可选链
        const memPercent = data.memory?.usedPercentage;
        if (typeof memPercent === 'number') { 
            updateProgressBar('memoryProgress', memPercent);
            // console.log(`[systemStatus] Updated memory progress bar with: ${memPercent}%`);
        } else {
            updateProgressBar('memoryProgress', 0);
             // console.log('[systemStatus] Memory data invalid or missing usedPercentage for progress bar.');
        }
    } catch (e) {
        // console.warn('[systemStatus] Failed to update memory progress bar:', e);
        updateProgressBar('memoryProgress', 0);
    }
    
    // 更新CPU使用进度条
    try {
        // 使用可选链
        const cpuUsage = data.cpu?.usage;
        if (typeof cpuUsage === 'number') { 
            updateProgressBar('cpuProgress', cpuUsage);
            // console.log(`[systemStatus] Updated CPU progress bar with: ${cpuUsage}%`);
        } else {
            updateProgressBar('cpuProgress', 0);
            // console.log('[systemStatus] CPU data invalid or missing usage for progress bar.');
        }
    } catch (e) {
        // console.warn('[systemStatus] Failed to update CPU progress bar:', e);
        updateProgressBar('cpuProgress', 0);
    }
    
    // console.log('[systemStatus] UI update process finished.');
}

// 显示系统状态加载
function showSystemStatusLoading() {
    // console.log('显示系统状态加载中...');
    
    // 更新Docker容器表格状态为加载中
    const containerTable = document.getElementById('dockerContainersTable');
    const containerBody = document.getElementById('dockerContainersBody');
    
    if (containerTable && containerBody) {
        containerBody.innerHTML = `
            <tr>
                <td colspan="5" class="text-center">
                    <div class="loading-container">
                        <div class="spinner-border text-primary" role="status">
                            <span class="visually-hidden">加载中...</span>
                        </div>
                        <p class="mt-2">正在加载Docker容器信息...</p>
                    </div>
                </td>
            </tr>
        `;
    }
    
    // 更新活动表格状态为加载中
    const activitiesTable = document.getElementById('recentActivitiesTable');
    if (activitiesTable) {
        const tbody = activitiesTable.querySelector('tbody') || activitiesTable;
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="3" class="text-center">
                        <div class="loading-container">
                            <div class="spinner-border text-primary" role="status">
                                <span class="visually-hidden">加载中...</span>
                            </div>
                            <p class="mt-2">正在加载系统活动信息...</p>
                        </div>
                    </td>
                </tr>
            `;
        }
    }
}

// 更新进度条
function updateProgressBar(id, percentage) {
    const bar = document.getElementById(id);
    if (bar) {
        // 确保 percentage 是有效的数字，否则设为 0
        const validPercentage = (typeof percentage === 'number' && !isNaN(percentage)) ? Math.max(0, Math.min(100, percentage)) : 0;
        // console.log(`[systemStatus] Setting progress bar ${id} to ${validPercentage}%`);
        bar.style.width = `${validPercentage}%`;
        bar.setAttribute('aria-valuenow', validPercentage); // 更新 aria 属性
        
        // 根据使用率改变颜色
        if (validPercentage < 50) {
            bar.className = 'progress-bar bg-success';
        } else if (validPercentage < 80) {
            bar.className = 'progress-bar bg-warning';
        } else {
            bar.className = 'progress-bar bg-danger';
        }
    } else {
         // console.warn(`[systemStatus] Progress bar element with id '${id}' not found.`);
    }
}

// 显示详情对话框 - 修改为直接使用缓存数据
function showDetailsDialog(type) {
    try {
        let title = '';
        let htmlContent = ''; // 用于生成内容的变量

        if (!currentSystemData) {
            htmlContent = '<div class="error-message">系统状态数据尚未加载。</div>';
        } else {
            switch(type) {
                case 'containers':
                    title = '容器详情';
                    htmlContent = generateContainerDetailsHtml(currentSystemData.dockerContainers);
                    break;
                case 'memory':
                    title = '内存使用详情';
                    htmlContent = generateMemoryDetailsHtml(currentSystemData.memory);
                    break;
                case 'cpu':
                    title = 'CPU 使用详情';
                    htmlContent = generateCpuDetailsHtml(currentSystemData.cpu);
                    break;
                case 'disk':
                    title = '磁盘使用详情';
                    htmlContent = generateDiskDetailsHtml(currentSystemData.disk);
                    break;
                default:
                    title = '详情';
                    htmlContent = '<p>未知详情类型</p>';
            }
        }
        
        // 使用 SweetAlert2 显示对话框
        Swal.fire({
            title: title,
            html: `<div id="detailsContent" class="details-swal-content">${htmlContent}</div>`,
            width: '80%', // 可以更宽以容纳表格或详细信息
            showConfirmButton: false,
            showCloseButton: true,
            customClass: {
                popup: 'details-swal-popup' // 添加自定义类
            }
        });
    } catch (error) {
        // console.error('显示详情对话框失败:', error);
        core.showAlert('加载详情时出错: ' + error.message, 'error');
    }
}

// --- 修改：生成容器详情 HTML (类Excel表头+多行数据) ---
function generateContainerDetailsHtml(containers) {
    if (!Array.isArray(containers)) return '<p class="text-muted text-center py-3">容器数据无效</p>';
    
    let html = '<div class="details-table-container">';
    // 添加 resource-details-excel 类并使用 table-bordered
    html += '<table class="table table-sm table-bordered table-hover details-table resource-details-excel">'; 
    html += '<thead class="table-light"><tr><th>ID</th><th>名称</th><th>镜像</th><th>状态</th><th>创建时间</th></tr></thead>'; 
    html += '<tbody>';
    
    if (containers.length > 0) {
        containers.forEach(container => {
            const statusClass = dockerManager.getContainerStatusClass(container.state); 
            const containerId = container.id || '-';
            const containerName = container.name || '-';
            const containerImage = container.image || '-';
            const containerState = container.state || '-';
            const containerCreated = container.created ? formatTime(container.created) : '-';
            
            // 生成数据行，<td> 对应表头的顺序
            html += `<tr>
                <td title="${containerId}">${containerId.substring(0, 12)}</td>
                <td title="${containerName}">${containerName}</td>
                <td title="${containerImage}">${containerImage}</td>
                <td><span class="badge ${statusClass}">${containerState}</span></td>
                <td>${containerCreated}</td> 
            </tr>`;
        });
    } else {
        html += '<tr><td colspan="5" class="text-center text-muted py-3">没有找到容器</td></tr>'; // Colspan 调整为 5
    }
    
    html += '</tbody></table></div>';
    return html;
}

// --- 修改：生成内存详情 HTML (类Excel表头+单行数据) ---
function generateMemoryDetailsHtml(memoryData) {
    if (!memoryData) return '<p class="text-muted text-center py-3">内存数据不可用</p>';
    
    const total = formatByteSize(memoryData.total);
    const used = formatByteSize(memoryData.used);
    const free = formatByteSize(memoryData.free);
    let usagePercent = '未知';
    
    if (typeof memoryData.percent === 'string') {
        usagePercent = memoryData.percent;
    } else if (typeof memoryData.total === 'number' && typeof memoryData.used === 'number' && memoryData.total > 0) {
        const percent = (memoryData.used / memoryData.total) * 100;
        usagePercent = `${percent.toFixed(1)}%`;
    }
    
    let html = '<div class="details-table-container">';
    html += '<table class="table table-sm table-bordered details-table resource-details-excel">'; // 添加新类
    html += '<thead class="table-light"><tr><th>总内存</th><th>已用内存</th><th>空闲内存</th><th>内存使用率</th></tr></thead>';
    html += `<tbody id="memory-details-body">`;
    html += `<tr><td>${total}</td><td>${used}</td><td>${free}</td><td>${usagePercent}</td></tr>`;
    html += '</tbody></table></div>';
    return html;
}

// --- 修改：生成 CPU 详情 HTML (类Excel表头+单行数据) ---
function generateCpuDetailsHtml(cpuData) {
    if (!cpuData) return '<p class="text-muted text-center py-3">CPU 数据不可用</p>';
    
    let usagePercent = '未知';
    if (Array.isArray(cpuData.loadAvg) && cpuData.loadAvg.length > 0) {
        const cores = cpuData.cores || 1;
        const cpuUsage = (cpuData.loadAvg[0] / cores) * 100;
        usagePercent = `${Math.min(cpuUsage, 100).toFixed(1)}%`;
    }
    
    // 处理CPU速度
    let cpuSpeed = '未知';
    if (cpuData.speed) {
        cpuSpeed = `${cpuData.speed} MHz`;
    }
    
    let html = '<div class="details-table-container">';
    html += '<table class="table table-sm table-bordered details-table resource-details-excel">'; // 添加新类
    html += '<thead class="table-light"><tr><th>CPU 核心数</th><th>CPU 型号</th><th>CPU 速度</th><th>当前使用率</th></tr></thead>';
    html += `<tbody id="cpu-details-body">`;
    html += `<tr><td>${cpuData.cores || '未知'}</td><td>${cpuData.model || '未知'}</td><td>${cpuSpeed}</td><td>${usagePercent}</td></tr>`;
    html += '</tbody></table></div>';
    
    // 如果有loadAvg，添加额外的负载信息表格
    if (Array.isArray(cpuData.loadAvg) && cpuData.loadAvg.length >= 3) {
        html += '<h6 class="mt-3">系统平均负载</h6>';
        html += '<table class="table table-sm table-bordered details-table">';
        html += '<thead class="table-light"><tr><th>1分钟</th><th>5分钟</th><th>15分钟</th></tr></thead>';
        html += '<tbody>';
        html += `<tr><td>${cpuData.loadAvg[0].toFixed(2)}</td><td>${cpuData.loadAvg[1].toFixed(2)}</td><td>${cpuData.loadAvg[2].toFixed(2)}</td></tr>`;
        html += '</tbody></table>';
    }
    
    return html;
}

// --- 修改：生成磁盘详情 HTML (类Excel表头+单行数据) ---
function generateDiskDetailsHtml(diskData) {
    if (!diskData) return '<p class="text-muted text-center py-3">磁盘数据不可用</p>';
    
    // 确保有展示数据，无论是来自哪个来源
    if (currentSystemData && currentSystemData.disk && !diskData.size) {
        diskData = currentSystemData.disk;
    }
    
    let html = '<div class="details-table-container">';
    html += '<table class="table table-sm table-bordered details-table resource-details-excel">'; // 添加新类
    html += '<thead class="table-light"><tr><th>总空间</th><th>已用空间</th><th>可用空间</th><th>使用率</th></tr></thead>';
    html += `<tbody id="disk-details-body">`;
    html += `<tr><td>${diskData.size || '未知'}</td><td>${diskData.used || '未知'}</td><td>${diskData.available || '未知'}</td><td>${diskData.percent || '未知'}</td></tr>`;
    html += '</tbody></table></div>';
    
    // 添加额外的文件系统信息表格
    if (diskData.filesystem) {
        html += '<h6 class="mt-3">文件系统信息</h6>';
        html += '<table class="table table-sm table-bordered details-table">';
        html += '<tbody>';
        html += `<tr><th>文件系统</th><td>${diskData.filesystem}</td></tr>`;
        if (diskData.mounted) {
            html += `<tr><th>挂载点</th><td>${diskData.mounted}</td></tr>`;
        }
        html += '</tbody></table>';
    }
    
    return html;
}

// 更新Docker状态指示器
function updateDockerStatus(available) {
    // console.log(`[systemStatus] Updating top Docker status indicator to: ${available ? 'running' : 'stopped'}`);
    const statusIndicator = document.getElementById('dockerStatusIndicator'); // 假设这是顶部指示器的 ID
    const statusText = document.getElementById('dockerStatusText'); // 假设这是顶部文本的 ID
    
    if (!statusIndicator || !statusText) {
         console.warn('[systemStatus] Top Docker status indicator elements not found.');
         return;
    }
    
    if (available) {
        statusIndicator.style.backgroundColor = 'var(--success-color, #4CAF50)'; // 使用 CSS 变量或默认值
        statusText.textContent = 'Docker 运行中';
        statusIndicator.title = 'Docker 服务正常运行中';
        statusIndicator.classList.remove('stopped');
        statusIndicator.classList.add('running');
    } else {
        statusIndicator.style.backgroundColor = 'var(--danger-color, #f44336)';
        statusText.textContent = 'Docker 未运行';
        statusIndicator.title = 'Docker 服务未运行或无法访问';
        statusIndicator.classList.remove('running');
        statusIndicator.classList.add('stopped');
    }
}

// 显示Docker帮助信息
function showDockerHelp() {
    Swal.fire({
        title: '<i class="fas fa-info-circle"></i> Docker 服务未运行',
        html: `
            <div class="docker-help-content text-start" style="text-align: left;">
                <p class="mb-3">看起来 Docker 服务当前没有运行，或者应用程序无法连接到它。请检查以下常见原因：</p>
                <ol class="mb-4" style="padding-left: 20px;">
                    <li class="mb-2"><strong>服务未启动：</strong> 确保 Docker Desktop (Windows/Mac) 或 Docker daemon (Linux) 正在运行。</li>
                    <li class="mb-2"><strong>权限问题：</strong> 运行此程序的用户可能需要添加到 'docker' 用户组 (Linux)。</li>
                    <li class="mb-2"><strong>Docker Socket：</strong> 确认 Docker Socket 文件的路径和权限是否正确配置 (通常是 <code>/var/run/docker.sock</code> on Linux)。</li>
                    <li class="mb-2"><strong>防火墙：</strong> 检查是否有防火墙规则阻止了与 Docker 的通信。</li>
                </ol>
                <div class="docker-cmd-examples">
                    <p><strong>常用诊断命令 (Linux):</strong></p>
                    <pre class="code-block"><code>sudo systemctl status docker</code></pre>
                    <pre class="code-block"><code>sudo systemctl start docker</code></pre>
                    <pre class="code-block"><code>sudo systemctl enable docker</code></pre>
                    <pre class="code-block"><code>docker ps</code></pre>
                    <pre class="code-block"><code>groups ${USER} # 检查是否在 docker 组</code></pre>
                    <pre class="code-block mb-0"><code>sudo usermod -aG docker ${USER} # 添加用户到 docker 组 (需要重新登录生效)</code></pre>
                </div>
                 <p class="mt-3 small text-muted">如果问题仍然存在，请查阅 Docker 官方文档或检查应用程序的日志。</p>
            </div>
        `,
        icon: null,
        confirmButtonText: '我知道了',
        customClass: {
            popup: 'docker-help-popup',
            content: 'docker-help-swal-content'
        },
        width: '650px'
    });
}

// 初始化仪表板
function initDashboard() {
    // 检查仪表板容器是否存在
    const dashboardGrid = document.querySelector('.dashboard-grid');
    if (!dashboardGrid) return;
    
    // 清空现有内容
    dashboardGrid.innerHTML = '';
    
    // 添加四个统计卡片
    const cardsData = [
        {
            id: 'containers',
            title: '容器数量',
            icon: 'fa-cubes',
            value: '--',
            description: '运行中的容器总数',
            trend: '',
            action: '查看详情'
        },
        {
            id: 'memory',
            title: '内存使用',
            icon: 'fa-memory',
            value: '--',
            description: '内存占用百分比',
            trend: '',
            action: '查看详情'
        },
        {
            id: 'cpu',
            title: 'CPU负载',
            icon: 'fa-microchip',
            value: '--',
            description: 'CPU平均负载',
            trend: '',
            action: '查看详情'
        },
        {
            id: 'disk',
            title: '磁盘空间',
            icon: 'fa-hdd',
            value: '--',
            description: '磁盘占用百分比',
            trend: '',
            action: '查看详情'
        }
    ];
    
    // 为每个卡片创建HTML并添加到仪表板网格
    cardsData.forEach(card => {
        const cardElement = createDashboardCard(card);
        dashboardGrid.appendChild(cardElement);
    });
    
    // 初始化刷新按钮
    const refreshBtn = document.getElementById('refreshSystemBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', refreshSystemStatus);
    }
    
    // 初始加载系统状态
    refreshSystemStatus(); // <-- 调用确保加载数据
    
    // console.log('仪表板初始化完成');
}

// 创建仪表板卡片
function createDashboardCard(cardInfo) {
    const card = document.createElement('div');
    card.className = 'dashboard-card';
    card.id = `${cardInfo.id}-card`;

    // Icon: Use cardInfo.icon directly as it should contain the full class string (e.g., "fas fa-microchip")
    const iconHtml = cardInfo.icon ? `<i class="${cardInfo.icon}"></i>` : '';

    // Action: Determine if it's a link or a callback
    let actionHtml = '';
    if (cardInfo.actionLink) {
        actionHtml = `<a href="${cardInfo.actionLink}" class="card-action">${cardInfo.actionText || '查看'}</a>`;
    } else if (cardInfo.actionCallback && typeof cardInfo.actionCallback === 'function') {
        // Register the callback and create a link to call handleCardAction
        window.systemStatus.cardActionCallbacks[cardInfo.id] = cardInfo.actionCallback;
        actionHtml = `<a href="javascript:void(0)" class="card-action" onclick="window.systemStatus.handleCardAction('${cardInfo.id}')">${cardInfo.actionText || '操作'}</a>`;
    } else if (cardInfo.actionText) {
        // Fallback if only actionText is provided (no specific action)
        actionHtml = `<span class="card-action is-text">${cardInfo.actionText}</span>`;
    }

    card.innerHTML = `
        <div class="card-icon" style="background-color: ${cardInfo.color || 'var(--primary-light)'}; color: ${cardInfo.color ? 'white' : 'var(--primary-color)'};">
            ${iconHtml}
        </div>
        <div class="card-content">
            <h3 class="card-title">${cardInfo.title || '未命名卡片'}</h3>
            <div class="card-value ${cardInfo.valueClass || ''}" id="${cardInfo.id}-value">
                ${cardInfo.value !== undefined ? cardInfo.value : '--'} ${cardInfo.unit || ''}
            </div>
            ${cardInfo.description ? `<div class="card-description">${cardInfo.description}</div>` : ''}
        </div>
        ${actionHtml ? `<div class="card-footer">${actionHtml}</div>` : ''}
    `;
    
    return card;
}

// 更新仪表板卡片
function updateDashboardCards(data) {
    logger.debug('Updating dashboard cards with data:', data);

    const dashboardGrid = document.querySelector('.dashboard-grid');
    if (!dashboardGrid) {
        logger.warn('Dashboard grid not found. Cannot update cards.');
        return;
    }

    // 清空旧的回调
    window.systemStatus.cardActionCallbacks = {};

    // 确保有 dockerContainers 数据
    const containers = Array.isArray(data.dockerContainers) ? data.dockerContainers : [];
    
    // 过滤掉错误指示对象和没有有效ID的容器
    const validContainers = containers.filter(c => c && c.id && c.id !== 'n/a' && !c.error);
    const runningContainersCount = validContainers.filter(c => c.state && typeof c.state === 'string' && c.state.toLowerCase().includes('running')).length;
    const totalValidContainersCount = validContainers.length;

    logger.debug('Valid containers for dashboard:', validContainers);
    logger.debug(`Running: ${runningContainersCount}, Total Valid: ${totalValidContainersCount}`);

    const cardsData = [
        {
            id: 'dockerStatus',
            title: 'Docker 服务',
            value: data.dockerStatus === 'running' ? '运行中' : '已停止',
            description: data.dockerStatus === 'running' ? '服务连接正常' : '服务未连接或不可用',
            icon: 'fab fa-docker',
            color: data.dockerStatus === 'running' ? 'var(--success-color)' : 'var(--danger-color)',
            actionText: data.dockerStatus === 'running' ? '查看容器' : null,
            actionLink: data.dockerStatus === 'running' ? '#docker-status' : null,
            valueClass: data.dockerStatus === 'running' ? 'text-success' : 'text-danger'
        },
        {
            id: 'containersCount',
            title: '运行中容器',
            value: runningContainersCount,
            description: `总容器数: ${totalValidContainersCount}`,
            icon: 'fas fa-box-open',
            color: 'var(--primary-color)',
            actionText: '管理容器',
            actionCallback: () => {
                if (typeof dockerManager !== 'undefined' && typeof dockerManager.showContainersPage === 'function') {
                    core.navigateToSection('docker-status');
                } else if (typeof dockerManager !== 'undefined' && typeof dockerManager.showManagementModal === 'function') {
                    dockerManager.showManagementModal();
                } else {
                    window.location.hash = 'docker-status';
                    if (window.app && typeof window.app.handleNavigation === 'function') {
                        window.app.handleNavigation('docker-status');
                    } else if (core && typeof core.navigateToSection === 'function') {
                        core.navigateToSection('docker-status');
                    } else {
                        console.warn('No function found to display Docker management (modal or section).');
                        const sidebarItem = document.querySelector('li[data-section="docker-status"]');
                        if (sidebarItem) sidebarItem.click();
                        else alert('容器管理功能导航失败');
                    }
                }
            },
            unit: '个'
        },
        {
            id: 'cpuUsage',
            title: 'CPU 使用率',
            value: (() => {
                if (data.cpu) {
                    if (typeof data.cpu.usage === 'number' && !isNaN(data.cpu.usage)) return data.cpu.usage.toFixed(1) + '%';
                    if (typeof data.cpu.currentLoad === 'number' && !isNaN(data.cpu.currentLoad)) return data.cpu.currentLoad.toFixed(1) + '%';
                    if (typeof data.cpu.load === 'number' && !isNaN(data.cpu.load)) return data.cpu.load.toFixed(1) + '%';
                    if (data.cpu.currentLoad && typeof data.cpu.currentLoad.avgload === 'number' && !isNaN(data.cpu.currentLoad.avgload)) return data.cpu.currentLoad.avgload.toFixed(1) + '%';
                    // Add logic to calculate from loadAvg, similar to generateCpuDetailsHtml
                    if (Array.isArray(data.cpu.loadAvg) && data.cpu.loadAvg.length > 0 && typeof data.cpu.loadAvg[0] === 'number' && !isNaN(data.cpu.loadAvg[0])) {
                        const cores = data.cpu.cores || 1;
                        const cpuUsageFromLoadAvg = (data.cpu.loadAvg[0] / cores) * 100;
                        return Math.min(cpuUsageFromLoadAvg, 100).toFixed(1) + '%';
                    }
                }
                return 'N/A';
            })(),
            description: `核心数: ${data.cpu ? (data.cpu.cores || 'N/A') : 'N/A'}`,
            icon: 'fas fa-microchip',
            color: 'var(--warning-color)',
            actionText: '详细信息',
            actionCallback: () => showDetailsDialog('cpu'),
            unit: ''
        },
        {
            id: 'memoryUsage',
            title: '内存使用率',
            value: (() => {
                if (data.memory) {
                    // 优先基于 active 内存计算百分比 (更接近真实程序占用)
                    if (typeof data.memory.active === 'number' && typeof data.memory.total === 'number' && data.memory.total > 0 && !isNaN(data.memory.active)) {
                        return ((data.memory.active / data.memory.total) * 100).toFixed(1) + '%';
                    }
                    // 如果后端直接提供了基于某种标准计算的 usedPercentage，且 active 不可用，则使用它
                    if (typeof data.memory.usedPercentage === 'number' && !isNaN(data.memory.usedPercentage)) {
                         return data.memory.usedPercentage.toFixed(1) + '%';
                    }
                    // 最后，如果 active 和 usedPercentage 都没有，才基于 used 计算 (这可能包含缓存)
                    if (typeof data.memory.used === 'number' && typeof data.memory.total === 'number' && data.memory.total > 0 && !isNaN(data.memory.used)) {
                        return ((data.memory.used / data.memory.total) * 100).toFixed(1) + '%';
                    }
                }
                return 'N/A';
            })(),
            description: `已用: ${data.memory && typeof data.memory.used === 'number' && !isNaN(data.memory.used) ? formatByteSize(data.memory.used) : 'N/A'} / 总量: ${data.memory && data.memory.total ? formatByteSize(data.memory.total) : 'N/A'}`,
            icon: 'fas fa-memory',
            color: 'var(--info-color)',
            actionText: '详细信息',
            actionCallback: () => showDetailsDialog('memory'),
            unit: ''
        },
        {
            id: 'diskUsage',
            title: '磁盘使用率',
            value: data.disk && data.disk.percent ? data.disk.percent : 'N/A',
            description: `可用: ${data.disk && data.disk.available ? data.disk.available : 'N/A'} / 总量: ${data.disk && data.disk.size ? data.disk.size : 'N/A'}`,
            icon: 'fas fa-hdd',
            color: 'var(--secondary-color)',
            actionText: '详细信息',
            actionCallback: () => showDetailsDialog('disk'),
            unit: ''
        },
        {
            id: 'uptime', // 假设有一个API可以获取系统启动时间
            title: '系统运行时长',
            value: data.uptime || 'N/A', // 从 data.uptime 获取
            description: '系统持续运行时间',
            icon: 'fas fa-clock',
            color: 'var(--purple-color)', // 自定义颜色变量
            actionText: '系统日志',
            actionLink: '#system-logs', // 假设有系统日志页面
            unit: ''
        }
    ];

    dashboardGrid.innerHTML = ''; // 清空现有卡片

    cardsData.forEach(cardInfo => {
        if ((cardInfo.id === 'uptime' && !data.uptime) && cardInfo.id !== 'dockerStatus' && cardInfo.id !== 'containersCount') {
             // 如果是 uptime卡片且没有uptime数据，则跳过 (但保留 Docker 和容器数量卡片)
            if (cardInfo.id !== 'cpuUsage' && cardInfo.id !== 'memoryUsage' && cardInfo.id !== 'diskUsage') {
                logger.debug(`Skipping card ${cardInfo.id} due to missing data or specific condition.`);
                return;
            }
        }
        
        // 特殊处理 Docker 服务卡片，即使服务未运行也显示
        if (cardInfo.id === 'dockerStatus') {
             // 总是创建 Docker 状态卡片
        } else if (data.dockerStatus !== 'running' && 
                  (cardInfo.id === 'containersCount')) {
            // 如果Docker服务未运行，则只显示 "N/A" 或 0 对于容器数量
             cardInfo.value = 0; // 或 'N/A'
             cardInfo.description = 'Docker 服务未运行';
        } else if (data.dockerStatus !== 'running' && cardInfo.id !== 'uptime') {
             // 如果 Docker 服务未运行，并且不是 uptime 卡片，则跳过其他依赖 Docker 的卡片
            if (cardInfo.id !== 'cpuUsage' && cardInfo.id !== 'memoryUsage' && cardInfo.id !== 'diskUsage') {
                logger.debug(`Skipping card ${cardInfo.id} because Docker is not running.`);
                return;
            }
        }

        const cardElement = createDashboardCard(cardInfo);
        dashboardGrid.appendChild(cardElement);
    });
}

// 格式化字节大小为易读格式
function formatByteSize(bytes) {
    if (bytes === undefined || bytes === null) return '未知';
    if (typeof bytes === 'string') {
        if (!isNaN(parseInt(bytes))) {
            bytes = parseInt(bytes);
        } else {
            return bytes; // 如果已经是格式化字符串，直接返回
        }
    }
    
    if (typeof bytes !== 'number' || isNaN(bytes)) return '未知';
    
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    
    return `${size.toFixed(2)} ${units[unitIndex]}`;
}

// 更新内存详情表格
function updateMemoryDetailsTable(total, used, free, percent) {
    const memDetailsBody = document.getElementById('memory-details-body');
    if (memDetailsBody) {
        const percentText = typeof percent === 'number' ? `${percent.toFixed(1)}%` : '未知';
        memDetailsBody.innerHTML = `<tr><td>${total}</td><td>${used}</td><td>${free}</td><td>${percentText}</td></tr>`;
    }
}

// 更新CPU详情表格
function updateCpuDetailsTable(cores, model, speed, usage) {
    const cpuDetailsBody = document.getElementById('cpu-details-body');
    if (cpuDetailsBody) {
        const usageText = typeof usage === 'number' ? `${usage.toFixed(1)}%` : '未知';
        let speedText = speed;
        if (typeof speed === 'number') {
            speedText = `${speed} MHz`;
        }
        cpuDetailsBody.innerHTML = `<tr><td>${cores || '未知'}</td><td>${model || '未知'}</td><td>${speedText}</td><td>${usageText}</td></tr>`;
    }
}

// 更新磁盘详情表格
function updateDiskDetailsTable(total, used, available, percent) {
    const diskDetailsBody = document.getElementById('disk-details-body');
    if (diskDetailsBody) {
        const percentText = typeof percent === 'number' ? `${percent.toFixed(0)}%` : '未知';
        diskDetailsBody.innerHTML = `<tr><td>${total}</td><td>${used}</td><td>${available}</td><td>${percentText}</td></tr>`;
    }
}

// 更新活动表格
function updateActivitiesTable(activities) {
    const table = document.getElementById('recentActivitiesTable');
    if (!table) {
         console.warn('[systemStatus] Recent activities table not found.');
         return;
    }
    
    // 获取 tbody，如果不存在则创建
    let tbody = table.querySelector('tbody');
    if (!tbody) {
        tbody = document.createElement('tbody');
        table.appendChild(tbody);
    }
    
    // 清空表格内容
    tbody.innerHTML = '';
    
    // 确保 activities 是数组
    if (!Array.isArray(activities)) {
         console.warn('[systemStatus] activities data is not an array:', activities);
         activities = []; // 设为空数组避免错误
    }

    if (activities.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted py-3"><i class="fas fa-info-circle me-2"></i>暂无活动记录</td></tr>';
    } else {
        let html = '';
        activities.forEach(activity => {
            // 添加简单的 HTML 转义以防止 XSS (更健壮的方案应使用库)
            const safeDetails = (activity.details || '').replace(/</g, "&lt;").replace(/>/g, "&gt;");
            html += `
                <tr>
                    <td data-label="时间">${formatTime(activity.timestamp)}</td>
                    <td data-label="事件">${activity.event || '未知事件'}</td>
                    <td data-label="详情" title="${safeDetails}" class="text-truncate">${safeDetails}</td>
                </tr>
            `;
        });
        tbody.innerHTML = html;
    }
    console.log(`[systemStatus] Updated activities table with ${activities.length} items.`);
}

// 格式化时间
function formatTime(timestamp) {
    if (!timestamp) return '未知时间';
    
    const date = new Date(timestamp);
    const now = new Date();
    
    // 如果是今天的时间，只显示小时和分钟
    if (date.toDateString() === now.toDateString()) {
        return `今天 ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    }
    
    // 否则显示完整日期和时间
    return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

// 显示仪表盘加载状态
function showDashboardLoading() {
    const dashboardGrid = document.querySelector('.dashboard-grid');
    if (dashboardGrid) {
        // Instead of targeting specific value elements, show a general loading message
        // or a spinner within the grid itself if it's empty.
        // For now, we'll rely on the card creation process to populate it.
        // If cards are not yet defined, we can show a message.
        if (dashboardGrid.children.length === 0) {
             dashboardGrid.innerHTML = '<div class="loading-message"><div class="loading-spinner-large"></div><p>正在加载控制面板数据...</p></div>';
        }
    } 
    // The old method below targets specific value elements which might not exist before cards are drawn.
    // const cards = ['dockerStatus', 'containersCount', 'cpuUsage', 'memoryUsage', 'diskUsage', 'uptime'];
    // cards.forEach(id => {
    //     const valueElement = document.getElementById(`${id}-value`);
    //     if (valueElement) {
    //         valueElement.innerHTML = '<div class="loading-spinner-small"></div>';
    //     }
    // });
}

// 显示仪表盘错误
function showDashboardError(message) {
    // 在仪表盘上方添加错误通知
    const dashboardGrid = document.querySelector('.dashboard-grid');
    if (dashboardGrid) {
        // 检查是否已存在错误通知，避免重复添加
        let errorNotice = document.getElementById('dashboard-error-notice');
        if (!errorNotice) {
            errorNotice = document.createElement('div');
            errorNotice.id = 'dashboard-error-notice';
            errorNotice.className = 'dashboard-error-notice';
            errorNotice.innerHTML = `
                <i class="fas fa-exclamation-circle"></i>
                <span>数据加载失败: ${message}</span>
                <button onclick="systemStatus.refreshSystemStatus()">重试</button>
            `;
            dashboardGrid.parentNode.insertBefore(errorNotice, dashboardGrid);
            
            // 5秒后自动隐藏错误通知
            setTimeout(() => {
                if (errorNotice.parentNode) {
                    errorNotice.classList.add('fade-out');
                    setTimeout(() => {
                        if (errorNotice.parentNode) {
                            errorNotice.parentNode.removeChild(errorNotice);
                        }
                    }, 500);
                }
            }, 5000);
        }
    }
}

// --- 明确将需要全局调用的函数暴露到 window.systemStatus ---
// (确保 systemStatus 对象存在)
window.systemStatus = window.systemStatus || {}; 

// 暴露刷新函数（可能被其他模块或 HTML 调用）
window.systemStatus.refreshSystemStatus = refreshSystemStatus;

// 暴露显示详情函数（被 HTML 调用）
window.systemStatus.showDetailsDialog = showDetailsDialog;

// 暴露显示 Docker 帮助函数（被 HTML 或 dockerManager 调用）
window.systemStatus.showDockerHelp = showDockerHelp;

// 暴露初始化仪表盘函数（可能被 app.js 调用）
window.systemStatus.initDashboard = initDashboard;

// 暴露调试设置函数，方便开发时打开调试
window.systemStatus.setDebug = logger.setDebug;

// --- 新增：用于存储卡片操作回调 ---
window.systemStatus.cardActionCallbacks = {};

// --- 新增：处理卡片操作的通用函数 ---
window.systemStatus.handleCardAction = function(cardId) {
    if (window.systemStatus.cardActionCallbacks[cardId]) {
        window.systemStatus.cardActionCallbacks[cardId]();
    } else {
        console.warn(`No action callback registered for card ID: ${cardId}`);
    }
};

/* 添加一些基础样式到 CSS (如果 web/style.css 不可用，这里会失败) */
/* 理想情况下，这些样式应该放在 web/style.css */
const customHelpStyles = `
.docker-help-popup .swal2-title {
    font-size: 1.5rem;
    color: var(--primary-color);
    margin-bottom: 1.5rem;
}
/* 强制 SweetAlert 内容区左对齐 */
.docker-help-popup .swal2-html-container {
    text-align: left !important;
    margin-left: 1rem; /* 可选：增加左边距 */
    margin-right: 1rem; /* 可选：增加右边距 */
    /* border: 1px solid red !important; /* 临时调试边框 */
}
/* 确保我们自己的内容容器也强制左对齐 */
.docker-help-popup .docker-help-content {
    text-align: left !important;
}
.docker-help-swal-content {
    /* 这个类可能不再需要，但保留以防万一 */
    font-size: 0.95rem;
    line-height: 1.6;
}
.docker-help-content ol {
    margin-left: 1rem; /* 确保列表相对于左对齐的内容有缩进 */
}
/* 确保列表和代码块也继承或设置为左对齐 */
.docker-help-popup .docker-help-content ol,
.docker-help-popup .docker-help-content pre {
    text-align: left !important;
}
.docker-help-content .code-block {
    background-color: #f8f9fa; 
    border: 1px solid #e9ecef;
    padding: 0.5rem 0.8rem;
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 0.85rem;
    margin-bottom: 0.5rem;
    white-space: pre-wrap; /* 允许换行 */
    word-wrap: break-word; /* 强制换行 */
}
.docker-help-content .code-block code {
    background: none;
    padding: 0;
    color: inherit;
}
`;

// 尝试将样式添加到页面 (这是一种不太优雅的方式，最好是在 CSS 文件中定义)
try {
    const styleSheet = document.createElement("style");
    styleSheet.type = "text/css";
    styleSheet.innerText = customHelpStyles;
    document.head.appendChild(styleSheet);
} catch (e) {
    console.warn('无法动态添加 Docker 帮助样式:', e);
}
