/**
 * Global error sanitizer middleware.
 *
 * Intercepts all JSON responses that carry an `error` field on 4xx/5xx status
 * codes.  Technical / internal messages are replaced with a generic
 * user-friendly Chinese string while the original detail is logged to the
 * server console for debugging.
 */

const FRIENDLY_FALLBACKS = {
    400: '请求参数有误，请检查后重试。',
    401: '登录已过期，请重新登录。',
    402: '余额不足，请充值后重试。',
    403: '暂无权限执行此操作。',
    404: '请求的资源不存在。',
    409: '操作冲突，请刷新后重试。',
    413: '文件太大，请压缩后重试。',
    429: '请求过于频繁，请稍后再试。',
    500: '服务暂时不可用，请稍后再试。',
    502: '服务暂时不可用，请稍后再试。',
    503: '服务暂时不可用，请稍后再试。',
};

const SAFE_PATTERNS = [
    /^[\u4e00-\u9fff]/,
    /^Token\s/,
    /^余额不足/,
    /^请输入/,
    /^请选择/,
    /^密码/,
    /^账号/,
    /^用户名/,
    /^不能/,
    /^权限/,
    /^获取.*失败$/,
    /^创建.*失败$/,
    /^更新.*失败$/,
    /^删除.*失败$/,
    /^操作失败$/,
    /^充值失败$/,
    /^状态值无效$/,
    /^金额/,
    /^单次/,
    /^新密码/,
    /^旧密码/,
    /^模型 ID 已存在$/,
    /^缺少必填字段$/,
    /^当前视频模型暂不可用/,
    /^输入图片未通过内容审核/,
    /^登录失败/,
    /^修改密码失败/,
    /^头像上传失败$/,
    /^存储目录未配置$/,
];

function isSafeMessage(msg) {
    if (typeof msg !== 'string') return false;
    return SAFE_PATTERNS.some(re => re.test(msg));
}

function sanitizeErrorMessage(msg, statusCode) {
    if (typeof msg !== 'string' || !msg) {
        return FRIENDLY_FALLBACKS[statusCode] || FRIENDLY_FALLBACKS[500];
    }
    if (isSafeMessage(msg)) return msg;
    return FRIENDLY_FALLBACKS[statusCode] || FRIENDLY_FALLBACKS[500];
}

export function errorSanitizerMiddleware(req, res, next) {
    const originalJson = res.json.bind(res);

    res.json = function (data) {
        if (data && typeof data === 'object' && data.error && res.statusCode >= 400) {
            const original = data.error;
            const sanitized = sanitizeErrorMessage(original, res.statusCode);

            if (original !== sanitized) {
                console.error(
                    `[ErrorSanitizer] ${req.method} ${req.path} (${res.statusCode}): ${original}`
                );
            }

            return originalJson({ ...data, error: sanitized });
        }
        return originalJson(data);
    };

    next();
}

export function globalErrorHandler(err, req, res, _next) {
    console.error(`[Unhandled Error] ${req.method} ${req.path}:`, err.message || err);

    const statusCode = err.status || err.statusCode || 500;
    const friendlyMsg = FRIENDLY_FALLBACKS[statusCode] || FRIENDLY_FALLBACKS[500];

    res.status(statusCode).json({ error: friendlyMsg });
}
