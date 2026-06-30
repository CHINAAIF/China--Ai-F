export const Governance = {
  async validate(command) {
    const dangerousPatterns = [/eval\(/, /rm -rf/, /process\.exit/, /fs\.unlink/];
    const isDangerous = dangerousPatterns.some(pattern => pattern.test(command));
    
    if (isDangerous) return { safe: false, reason: "محاولة تنفيذ أمر خطير على النظام" };
    return { safe: true };
  }
};
