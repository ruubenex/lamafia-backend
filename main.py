from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from scraper import scrape_ads

app = FastAPI(title="Facebook Ad Library Scraper", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class SearchRequest(BaseModel):
    keywords: str
    min_copies: int = 1
    country: str = "BR"
    ad_type: str = "all"
    max_results: int = 50


class AdResult(BaseModel):
    page_name: str
    ad_text: str
    copies: int
    platforms: list[str]
    start_date: str
    ad_link: str
    page_link: str


class SearchResponse(BaseModel):
    total: int
    results: list[AdResult]
    search_url: str


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/search", response_model=SearchResponse)
async def search(req: SearchRequest):
    if not req.keywords.strip():
        raise HTTPException(status_code=400, detail="Keywords cannot be empty.")
    if req.max_results < 1 or req.max_results > 200:
        raise HTTPException(status_code=400, detail="max_results must be between 1 and 200.")

    import urllib.parse
    search_url = (
        f"https://www.facebook.com/ads/library/"
        f"?active_status=all&ad_type={req.ad_type}"
        f"&country={req.country}"
        f"&q={urllib.parse.quote(req.keywords)}"
        f"&search_type=keyword_unordered"
        f"&media_type=all"
    )

    try:
        ads = await scrape_ads(
            keywords=req.keywords,
            min_copies=req.min_copies,
            country=req.country,
            ad_type=req.ad_type,
            max_results=req.max_results,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Scraping error: {str(e)}")

    return SearchResponse(total=len(ads), results=ads, search_url=search_url)
