import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import uuid
import zipfile

spec = importlib.util.spec_from_file_location('verify_mobile', Path(__file__).resolve().parents[2] / 'scripts' / 'verify-mobile.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


class VerifierTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'bundle.zip'
        self.source = str(uuid.uuid4())
        self.entries = {}
        previous = None
        self.captures = []
        for text in ['Original section', 'Changed section']:
            capture = str(uuid.uuid4())
            self.captures.append(capture)
            self.entries[f'captures/{capture}/text.txt'] = text.encode()
            receipt = dict(id=capture, sourceID=self.source, title='Test', observedAt='2026-11-06T12:00:00Z', originalURL='https://example.com', method='user-supplied-text', files={'text.txt': module.digest(text.encode())})
            if previous:
                receipt['previousHash'] = previous
            raw = encode(receipt)
            self.entries[f'captures/{capture}/receipt.json'] = raw
            previous = module.digest(raw)
        self.manifest = dict(format='sourcewatch-mobile-evidence-v1', sourceID=self.source, captures=self.captures, files={k: module.digest(v) for k, v in self.entries.items()}, timestampNotice='Local time only')
        self.entries['manifest.json'] = encode(self.manifest)

    def write(self):
        with zipfile.ZipFile(self.path, 'w', compression=zipfile.ZIP_STORED) as archive:
            for name, content in self.entries.items():
                archive.writestr(name, content)

    def test_valid_chain(self):
        self.write()
        result = module.verify(self.path, module.digest(self.entries['manifest.json']))
        self.assertEqual(result['captures'], 2)
        self.assertTrue(result['ok'])

    def test_modified_file(self):
        self.entries[f'captures/{self.captures[0]}/text.txt'] = b'changed'
        self.write()
        with self.assertRaises(ValueError): module.verify(self.path)

    def test_missing_file(self):
        del self.entries[f'captures/{self.captures[0]}/text.txt']
        self.write()
        with self.assertRaises(ValueError): module.verify(self.path)

    def test_reordered_chain(self):
        self.manifest['captures'] = list(reversed(self.captures))
        self.entries['manifest.json'] = encode(self.manifest)
        self.write()
        with self.assertRaises(ValueError): module.verify(self.path)

    def test_replaced_manifest(self):
        checksum = module.digest(self.entries['manifest.json'])
        self.manifest['timestampNotice'] = 'Changed'
        self.entries['manifest.json'] = encode(self.manifest)
        self.write()
        with self.assertRaises(ValueError): module.verify(self.path, checksum)

    def test_unsafe_path(self):
        self.entries['../escape'] = b'no'
        self.write()
        with self.assertRaises(ValueError): module.verify(self.path)

    def test_unlisted_file(self):
        self.entries['extra.txt'] = b'no'
        self.write()
        with self.assertRaises(ValueError): module.verify(self.path)

    def test_truncated_zip(self):
        self.write()
        raw = self.path.read_bytes()
        self.path.write_bytes(raw[:-24])
        with self.assertRaises(zipfile.BadZipFile): module.verify(self.path)


if __name__ == '__main__':
    unittest.main()
