"""Enterprise knowledge base API."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from core.auth import require_admin, require_console_read, require_engine_ingest_global
from domain.models import (
    KnowledgeDocumentIngestBatch,
    KnowledgeFolderCreate,
    KnowledgeNativeDocCreate,
    KnowledgeNativeDocUpdate,
    KnowledgeSourceCreate,
    KnowledgeSourceUpdate,
    KnowledgeSpaceCreate,
)
from infra import knowledge

router = APIRouter(prefix="/api/v1/knowledge", tags=["knowledge"])


@router.get("/stats")
async def knowledge_stats(_session: dict | None = Depends(require_console_read)):
    del _session
    return knowledge.knowledge_stats()


@router.get("/search")
async def search_knowledge(
    q: str,
    source_type: str | None = None,
    source_id: str | None = None,
    team_id: str | None = None,
    space_id: str | None = None,
    limit: int = 20,
    _session: dict | None = Depends(require_console_read),
):
    del _session
    if not q.strip():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="query q is required")
    return {
        "query": q,
        "results": knowledge.search_documents(
            query=q,
            source_type=source_type,
            source_id=source_id,
            team_id=team_id,
            space_id=space_id,
            limit=min(limit, 100),
        ),
    }


@router.get("/spaces")
async def list_knowledge_spaces(limit: int = 100, _session: dict | None = Depends(require_console_read)):
    del _session
    return {"spaces": knowledge.list_spaces(limit=limit)}


@router.get("/spaces/{space_id}/tree")
async def get_knowledge_space_tree(space_id: str, _session: dict | None = Depends(require_console_read)):
    tree = knowledge.get_space_tree(space_id)
    if tree is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="space not found")
    return tree


@router.post("/spaces", dependencies=[Depends(require_admin)])
async def create_knowledge_space(body: KnowledgeSpaceCreate):
    try:
        space = knowledge.create_space(body)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return {"created": True, "space": space}


@router.post("/spaces/{space_id}/folders", dependencies=[Depends(require_admin)])
async def create_knowledge_folder(space_id: str, body: KnowledgeFolderCreate):
    try:
        folder = knowledge.create_folder(space_id, body)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return {"created": True, "folder": folder}


@router.post("/spaces/{space_id}/docs", dependencies=[Depends(require_admin)])
async def create_knowledge_native_doc(space_id: str, body: KnowledgeNativeDocCreate):
    try:
        doc = knowledge.create_native_doc(space_id, body)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return {"created": True, "document": doc}


@router.put("/native-docs/{doc_id}", dependencies=[Depends(require_admin)])
async def update_knowledge_native_doc(doc_id: str, body: KnowledgeNativeDocUpdate):
    try:
        doc = knowledge.update_native_doc(doc_id, body)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="document not found")
    return {"updated": True, "document": doc}


@router.post("/native-docs/{doc_id}/publish", dependencies=[Depends(require_admin)])
async def publish_knowledge_native_doc(doc_id: str):
    try:
        doc = knowledge.publish_native_doc(doc_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="document not found")
    return {"published": True, "document": doc}


@router.get("/sources")
async def list_public_sources(
    source_type: str | None = None,
    limit: int = 100,
    _session: dict | None = Depends(require_console_read),
):
    del _session
    sources = knowledge.list_sources(status="active", source_type=source_type, limit=limit)
    public = []
    for item in sources:
        public.append(
            {
                "source_id": item["source_id"],
                "source_type": item["source_type"],
                "name": item["name"],
                "team_id": item["team_id"],
                "document_count": item["document_count"],
                "last_sync_at": item["last_sync_at"],
                "last_sync_status": item["last_sync_status"],
            }
        )
    return {"sources": public}


@router.get("/documents/{doc_id}")
async def get_knowledge_document(doc_id: str, _session: dict | None = Depends(require_console_read)):
    del _session
    doc = knowledge.get_document(doc_id, include_content=True)
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="document not found")
    doc["source_type"] = _source_type(doc["source_id"])
    return {"document": doc}


@router.get("/sources/manage", dependencies=[Depends(require_admin)])
async def list_managed_sources(source_type: str | None = None, status_filter: str | None = None, limit: int = 100):
    return {
        "sources": knowledge.list_sources(status=status_filter, source_type=source_type, limit=limit),
    }


@router.post("/sources", dependencies=[Depends(require_admin)])
async def create_knowledge_source(body: KnowledgeSourceCreate):
    if knowledge.get_source(body.source_id):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="source_id already exists")
    source = knowledge.create_source(body)
    return {"created": True, "source": source}


@router.put("/sources/{source_id}", dependencies=[Depends(require_admin)])
async def update_knowledge_source(source_id: str, body: KnowledgeSourceUpdate):
    source = knowledge.update_source(source_id, body)
    if source is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="source not found")
    return {"updated": True, "source": source}


@router.delete("/sources/{source_id}", dependencies=[Depends(require_admin)])
async def delete_knowledge_source(source_id: str):
    if not knowledge.delete_source(source_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="source not found")
    return {"deleted": True, "source_id": source_id}


@router.post("/sources/{source_id}/sync", dependencies=[Depends(require_admin)])
async def sync_knowledge_source(source_id: str):
    if knowledge.get_source(source_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="source not found")
    try:
        result = knowledge.sync_source(source_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return {"sync": result}


@router.get("/sources/{source_id}/sync-logs", dependencies=[Depends(require_admin)])
async def list_knowledge_sync_logs(source_id: str, limit: int = 20):
    if knowledge.get_source(source_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="source not found")
    return {"logs": knowledge.list_sync_logs(source_id, limit=limit)}


@router.get("/documents", dependencies=[Depends(require_admin)])
async def list_knowledge_documents(
    source_id: str | None = None,
    team_id: str | None = None,
    query: str | None = None,
    limit: int = 50,
):
    return {
        "documents": knowledge.list_documents(
            source_id=source_id,
            team_id=team_id,
            query=query,
            limit=limit,
            include_content=False,
        )
    }


@router.post("/documents/ingest", dependencies=[Depends(require_engine_ingest_global)])
async def ingest_knowledge_documents(body: KnowledgeDocumentIngestBatch):
    if knowledge.get_source(body.source_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="source not found")
    try:
        result = knowledge.ingest_documents(body.source_id, body.documents)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return {"accepted": True, **result}


def _source_type(source_id: str) -> str:
    source = knowledge.get_source(source_id)
    return source["source_type"] if source else ""
