import os
from typing import List

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app import storage
from app.database import get_db
from app.deps import get_current_user, require_role
from app.file_locks import file_write_lock
from app.models import Role, User
from app.schemas import UserCreate, UserOut, UserRolesUpdate
from app.security import hash_password

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserOut)
def get_me(user: User = Depends(get_current_user)):
    return user


ALLOWED_AVATAR_TYPES = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
}
MAX_AVATAR_BYTES = 2 * 1024 * 1024


@router.post("/me/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ext = ALLOWED_AVATAR_TYPES.get(file.content_type)
    if ext is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"unsupported image type: {file.content_type}",
        )
    chunk_size = 64 * 1024
    contents = bytearray()
    while True:
        chunk = await file.read(chunk_size)
        if not chunk:
            break
        contents.extend(chunk)
        if len(contents) > MAX_AVATAR_BYTES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="image exceeds 2MB limit"
            )
    contents = bytes(contents)

    with file_write_lock(f"avatar:{user.id}"):
        if user.avatar_path:
            old_path = storage.base_dir() / user.avatar_path
            if old_path.exists():
                old_path.unlink()

        path = storage.avatar_path(user.id, ext)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = path.with_suffix(path.suffix + ".tmp")
        tmp_path.write_bytes(contents)
        os.replace(tmp_path, path)

        user.avatar_path = str(path.relative_to(storage.base_dir()))
        db.commit()
    return {"avatar_path": user.avatar_path}


@router.get("/{user_id}/avatar")
def get_avatar(
    user_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    target = db.query(User).filter(User.id == user_id).first()
    if target is None or not target.avatar_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="no avatar set"
        )
    path = storage.base_dir() / target.avatar_path
    if not path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="no avatar set"
        )
    content_type = next(
        (ct for ct, e in ALLOWED_AVATAR_TYPES.items() if target.avatar_path.endswith(f".{e}")),
        "application/octet-stream",
    )
    return FileResponse(path, media_type=content_type)


@router.get("", response_model=List[UserOut])
def list_users(
    db: Session = Depends(get_db), _: User = Depends(require_role(Role.admin))
):
    return db.query(User).all()


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_role(Role.admin)),
):
    if db.query(User).filter(User.username == payload.username).first():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="username taken"
        )
    user = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        is_admin="admin" in payload.roles,
        is_qca="qca" in payload.roles,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.patch("/{user_id}/roles", response_model=UserOut)
def update_user_roles(
    user_id: int,
    payload: UserRolesUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_role(Role.admin)),
):
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="user not found"
        )
    user.is_admin = "admin" in payload.roles
    user.is_qca = "qca" in payload.roles
    db.commit()
    db.refresh(user)
    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_role(Role.admin)),
):
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="user not found"
        )
    db.delete(user)
    db.commit()
