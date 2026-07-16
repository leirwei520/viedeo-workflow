/**
 * Frontend error sanitizer.
 *
 * Converts any technical / English error message coming from the API into
 * a generic, user-friendly Chinese string.  Messages that are already in
 * Chinese and considered safe are passed through unchanged.
 */

const SAFE_PREFIXES = [
  '余额不足',
  '请输入',
  '请选择',
  '密码',
  '账号',
  '用户名',
  '不能',
  '权限',
  '登录',
  '金额',
  '单次',
  '新密码',
  '旧密码',
  '当前视频模型暂不可用',
  '输入图片未通过内容审核',
  '视频生成失败',
  '修改密码失败',
  '请求参数有误',
  '登录已过期',
  '暂无权限',
  '服务暂时不可用',
  '请求过于频繁',
  '文件太大',
  '请求的资源不存在',
  '操作冲突',
];

const CHINESE_RE = /^[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/;

const KEYWORD_MAP: [RegExp, string][] = [
  [/balance|余额不足/i, '余额不足，请充值后重试。'],
  [/timeout|timed?\s*out|超时/i, '请求超时，请稍后再试。'],
  [/not\s*found|404/i, '请求的资源不存在。'],
  [/unauthorized|认证|令牌|token.*过期/i, '登录已过期，请重新登录。'],
  [/forbidden|权限|no permission/i, '暂无权限执行此操作。'],
  [/network|unreachable|ECONNREFUSED/i, '网络连接失败，请检查网络后重试。'],
  [/risk\s*control|content\s*moderation/i, '输入图片未通过内容审核（可能涉及版权），请更换图片后重试。'],
];

const FALLBACK = '操作失败，请稍后再试。';

function isSafeChinese(msg: string): boolean {
  if (!CHINESE_RE.test(msg)) return false;
  return SAFE_PREFIXES.some(prefix => msg.startsWith(prefix));
}

export function sanitizeError(error: unknown): string {
  const msg =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : String(error ?? '');

  if (!msg) return FALLBACK;

  if (isSafeChinese(msg)) return msg;

  for (const [pattern, friendly] of KEYWORD_MAP) {
    if (pattern.test(msg)) return friendly;
  }

  if (CHINESE_RE.test(msg)) return msg;

  return FALLBACK;
}
