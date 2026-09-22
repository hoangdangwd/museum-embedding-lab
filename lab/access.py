"""Signed display-name sessions; users do not need a password."""
import base64
import binascii
import hashlib
import hmac
import secrets
import time
from collections import deque
from threading import Lock


class Access:
    cookie = "embedding_lab_session"
    lifetime = 7 * 24 * 3600

    def __init__(self, secret: str = ""):
        self.secret = secret or secrets.token_hex(32)
        self.attempts = deque()
        self.paid_calls = deque()
        self.lock = Lock()

    @staticmethod
    def valid_username(username):
        return (isinstance(username, str) and bool(username.strip()) and len(username) <= 100
                and not any(ord(char) < 32 or ord(char) == 127 for char in username))

    def token(self, username):
        name = base64.urlsafe_b64encode(username.encode()).decode()
        issued = str(int(time.time())) + ":" + secrets.token_hex(16) + ":" + name
        signature = hmac.new(self.secret.encode(), issued.encode(), hashlib.sha256).hexdigest()
        return issued + ":" + signature

    def username(self, token):
        try:
            issued, nonce, name, signature = (token or "").split(":")
            age = time.time() - int(issued)
            expected = hmac.new(self.secret.encode(), (issued + ":" + nonce + ":" + name).encode(), hashlib.sha256).hexdigest()
            if not (0 <= age < self.lifetime and hmac.compare_digest(signature, expected)):
                return None
            username = base64.urlsafe_b64decode(name).decode()
            return username if self.valid_username(username) else None
        except (ValueError, TypeError, binascii.Error):
            return None

    def allow(self, queue, limit, window):
        with self.lock:
            now = time.monotonic()
            while queue and queue[0] < now - window:
                queue.popleft()
            if len(queue) >= limit:
                return False
            queue.append(now)
            return True
