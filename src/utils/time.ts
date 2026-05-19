export function nowUnix(): number {
  return Math.floor(Date.now() / 1000)
}

export function formatTimestamp(unix: number, timezone: string = 'Asia/Shanghai'): string {
  const date = new Date(unix * 1000)
  return date.toLocaleString('zh-CN', { timeZone: timezone })
}
