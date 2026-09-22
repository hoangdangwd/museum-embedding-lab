import hashlib
import io
import warnings
from dataclasses import dataclass

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_BYTES = 15 * 1024 * 1024
MAX_PIXELS = 30_000_000
PREPROCESS_VERSION = "rgb-exif-white-jpeg95-max1600-v1"


class LabError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


@dataclass
class Picture:
    jpeg: bytes
    digest: str
    width: int
    height: int


def read_picture(raw: bytes) -> Picture:
    if not raw or len(raw) > MAX_BYTES:
        raise LabError("Ảnh phải có dung lượng từ 1 byte đến 15 MB.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as original:
                if original.format not in {"JPEG", "PNG", "WEBP"}:
                    raise LabError("Chỉ nhận JPEG, PNG và WebP. Hãy xuất HEIC thành JPEG trước.")
                if original.width * original.height > MAX_PIXELS:
                    raise LabError("Ảnh vượt quá 30 megapixel; hãy giảm kích thước trước.")
                if getattr(original, "n_frames", 1) != 1:
                    raise LabError("Hãy dùng ảnh tĩnh, không dùng ảnh động.")
                original.load()
                picture = ImageOps.exif_transpose(original).convert("RGBA")
                background = Image.new("RGBA", picture.size, "white")
                background.alpha_composite(picture)
                picture = background.convert("RGB")
                if min(picture.size) < 32:
                    raise LabError("Ảnh quá nhỏ; mỗi chiều cần ít nhất 32 pixel.")
                picture.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
                output = io.BytesIO()
                picture.save(output, format="JPEG", quality=95)
                jpeg = output.getvalue()
                # Pixel fingerprint detects identical decoded images without metadata.
                digest = hashlib.sha256(str(picture.size).encode() + picture.tobytes()).hexdigest()
                return Picture(jpeg, digest, *picture.size)
    except LabError:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError,
            Image.DecompressionBombWarning) as exc:
        raise LabError("Không đọc được ảnh. File có thể bị hỏng hoặc không đúng định dạng.") from exc
