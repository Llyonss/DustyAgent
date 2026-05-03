import sys
from rembg import remove
from PIL import Image

img = Image.open(sys.argv[1])
out = remove(img)
out.save(sys.argv[2])
print("ok")
