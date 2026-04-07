import paramiko
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('111.229.132.159', username='root', password='Oxl2lly1314!', timeout=10)

cmds = sys.argv[1:]
if not cmds:
    cmds = ['echo "No command provided"']

for cmd in cmds:
    print(f"\n>>> {cmd}")
    print("-" * 60)
    stdin, stdout, stderr = c.exec_command(cmd, timeout=60)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if out:
        print(out)
    if err:
        print("STDERR:", err)

c.close()
