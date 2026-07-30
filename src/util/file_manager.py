import os
import re
import shutil

# 파일명에서 경로/위험 문자 제거
def _sanitize_filename(name: str) -> str:
    name = os.path.basename(name or "attachment.bin").strip()
    name = re.sub(r"[^A-Za-z0-9._-]", "_", name)
    return name or "attachment.bin"

# 업데이트 시 생기는 update_output 폴더 속 새로운 결과 파일 삭제
def _delete_old_update_files(paths):
    update_output_dir = paths.UPDATE_DIR
    if not os.path.exists(update_output_dir):
        return

    folders = sorted([
        f for f in os.listdir(update_output_dir)
        if os.path.isdir(os.path.join(update_output_dir, f))
    ])

    for folder in folders[:-1]:
        folder_path = os.path.join(update_output_dir, folder)
        try:
            shutil.rmtree(folder_path)
            print(f"[CLEANUP] 삭제: {folder_path}")
        except Exception as e:
            print(f"[CLEANUP] 삭제 실패 (무시): {e}")