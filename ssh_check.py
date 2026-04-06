import paramiko

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('111.229.132.159', username='root', password='Oxl2lly1314!', timeout=10)

cmds = [
    'echo "=== CPU ===" && cat /proc/cpuinfo | grep "model name" | head -1 && echo "CPU cores:" && cat /proc/cpuinfo | grep processor | wc -l',
    'echo "=== MEMORY ===" && free -h',
    'echo "=== DISK ===" && df -h',
    'echo "=== DOCKER ===" && (docker --version 2>/dev/null || echo "No Docker")',
    'echo "=== PORTS LISTENING ===" && ss -tlnp | head -20',
    'echo "=== RUNNING SERVICES ===" && systemctl list-units --type=service --state=running --no-pager | head -30',
]

for cmd in cmds:
    stdin, stdout, stderr = c.exec_command(cmd)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if out:
        print(out)
    if err:
        print("STDERR:", err)

c.close()
