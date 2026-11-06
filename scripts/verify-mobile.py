#!/usr/bin/env python3
"""Offline SourceWatch Mobile verifier. Python standard library only; never extracts ZIPs."""
import argparse
import hashlib
import json
from pathlib import Path
import uuid
import zipfile

MAX_BUNDLE = 128 * 1024 * 1024


def digest(value):
    return hashlib.sha256(value).hexdigest()


def valid_id(value):
    try:
        uuid.UUID(value)
        return True
    except (ValueError, TypeError, AttributeError):
        return False


def safe_path(name):
    return (isinstance(name, str) and not any(c in name for c in ('\\', ':', '\0'))
            and all(part not in ('', '.', '..') for part in name.split('/')))


def verify(path, expected=None):
    if Path(path).stat().st_size > MAX_BUNDLE + 8 * 1024 * 1024:
        raise ValueError('ZIP exceeds size limit')
    with zipfile.ZipFile(path) as archive:
        infos = archive.infolist()
        if len(infos) > 5000 or sum(i.file_size for i in infos) > MAX_BUNDLE:
            raise ValueError('ZIP exceeds resource limits')
        names = [i.filename for i in infos]
        if len(set(names)) != len(names) or not all(safe_path(n) for n in names):
            raise ValueError('Unsafe or duplicate ZIP path')
        if any(i.compress_type != zipfile.ZIP_STORED or i.flag_bits & ~0x800 for i in infos):
            raise ValueError('Unsupported ZIP format: expected a stored SourceWatch Mobile export')
        entries = {i.filename: archive.read(i) for i in infos}  # zipfile also checks CRC32
    raw = entries.get('manifest.json')
    if raw is None or len(raw) > 2 * 1024 * 1024:
        raise ValueError('Missing or oversized manifest')
    if expected and digest(raw) != expected.lower():
        raise ValueError('Manifest does not match retained checksum')
    manifest = json.loads(raw)
    captures, files = manifest['captures'], manifest['files']
    if (manifest['format'] != 'sourcewatch-mobile-evidence-v1'
            or not valid_id(manifest['sourceID']) or not 1 <= len(captures) <= 1000
            or len(set(captures)) != len(captures)):
        raise ValueError('Invalid mobile manifest')
    if set(entries) != set(files) | {'manifest.json'}:
        raise ValueError('Missing or unexpected files')
    for name, checksum in files.items():
        if not safe_path(name) or digest(entries[name]) != checksum:
            raise ValueError('Missing or modified: ' + name)
    previous = None
    for capture in captures:
        if not valid_id(capture):
            raise ValueError('Invalid capture identifier')
        record_bytes = entries[f'captures/{capture}/receipt.json']
        record = json.loads(record_bytes)
        if (record['id'] != capture or record['sourceID'] != manifest['sourceID']
                or record.get('previousHash') != previous or 'text.txt' not in record['files']):
            raise ValueError('Capture chain mismatch: ' + capture)
        for name, checksum in record['files'].items():
            if (not safe_path(name) or '/' in name or name == 'receipt.json'
                    or files.get(f'captures/{capture}/{name}') != checksum):
                raise ValueError('Artifact absent from manifest: ' + name)
        previous = digest(record_bytes)
    return {'ok': True, 'captures': len(captures), 'manifestSha256': digest(raw), 'errors': []}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('bundle', help='SourceWatch Mobile evidence ZIP')
    parser.add_argument('--manifest-sha256', help='Checksum retained separately from the bundle')
    args = parser.parse_args()
    try:
        print(json.dumps(verify(args.bundle, args.manifest_sha256), indent=2))
    except (ValueError, OSError, KeyError, TypeError, zipfile.BadZipFile, RuntimeError) as error:
        print(json.dumps({'ok': False, 'errors': [str(error)]}, indent=2))
        raise SystemExit(1)
