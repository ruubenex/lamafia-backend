import asyncio
import re
from typing import Optional
from playwright.async_api import async_playwright, Page, TimeoutError as PlaywrightTimeout

AD_LIBRARY_URL = "https://www.facebook.com/ads/library/"


def build_search_url(keywords: str, country: str = "BR", ad_type: str = "all") -> str:
    import urllib.parse
    q = urllib.parse.quote(keywords)
    return (
        f"{AD_LIBRARY_URL}"
        f"?active_status=all"
        f"&ad_type={ad_type}"
        f"&country={country}"
        f"&q={q}"
        f"&search_type=keyword_unordered"
        f"&media_type=all"
    )


def parse_copies(text: str) -> int:
    """Extract number of ad copies from text like 'Runs 12 copies of this ad'."""
    match = re.search(r"(\d[\d,]*)\s+cop", text, re.IGNORECASE)
    if match:
        return int(match.group(1).replace(",", ""))
    return 1


async def scrape_ads(
    keywords: str,
    min_copies: int = 1,
    country: str = "BR",
    ad_type: str = "all",
    max_results: int = 50,
) -> list[dict]:
    url = build_search_url(keywords, country, ad_type)
    results = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 1280, "height": 900},
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            locale="pt-BR",
        )
        page = await context.new_page()

        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            await page.wait_for_timeout(4000)

            # Dismiss cookie/consent dialogs if present
            for selector in [
                '[data-testid="cookie-policy-dialog-accept-button"]',
                'button[title="Only allow essential cookies"]',
                'button:has-text("Aceitar tudo")',
                'button:has-text("Allow all cookies")',
                'button:has-text("Aceitar todos os cookies")',
            ]:
                try:
                    btn = page.locator(selector).first
                    if await btn.is_visible(timeout=2000):
                        await btn.click()
                        await page.wait_for_timeout(1500)
                        break
                except Exception:
                    pass

            await page.wait_for_timeout(3000)

            # Scroll and collect cards
            collected = set()
            scroll_attempts = 0
            max_scroll = 15

            while len(results) < max_results and scroll_attempts < max_scroll:
                # Try broad card selectors
                cards = await page.query_selector_all(
                    '[class*="x8gbvx8"][class*="x13faqbe"], '
                    'div[class*="_7jvw"], '
                    'div[class*="xh8yej3"]'
                )
                if not cards:
                    cards = await page.query_selector_all(
                        'div[role="article"], div[data-ad-id]'
                    )

                for card in cards:
                    if len(results) >= max_results:
                        break

                    try:
                        card_text = await card.inner_text()
                    except Exception:
                        continue

                    # Deduplicate by first 100 chars
                    key = card_text[:100].strip()
                    if key in collected or len(key) < 20:
                        continue
                    collected.add(key)

                    copies = parse_copies(card_text)
                    if copies < min_copies:
                        continue

                    # Page name - usually the first bold/prominent text
                    page_name = ""
                    try:
                        name_el = await card.query_selector(
                            'a[role="link"] span, strong, [class*="x1heor9g"]'
                        )
                        if name_el:
                            page_name = (await name_el.inner_text()).strip()
                    except Exception:
                        pass

                    # Ad link
                    ad_link = ""
                    try:
                        link_el = await card.query_selector('a[href*="/ads/library/"]')
                        if link_el:
                            ad_link = await link_el.get_attribute("href") or ""
                    except Exception:
                        pass

                    # Page link
                    page_link = ""
                    try:
                        plink_el = await card.query_selector(
                            'a[href*="facebook.com"]:not([href*="/ads/library/"])'
                        )
                        if plink_el:
                            page_link = await plink_el.get_attribute("href") or ""
                    except Exception:
                        pass

                    # Ad text (first 400 chars)
                    lines = [l.strip() for l in card_text.split("\n") if l.strip()]
                    ad_text = " | ".join(lines[:6])[:400]

                    # Platforms
                    platforms = []
                    for platform in ["Facebook", "Instagram", "Messenger", "Audience Network"]:
                        if platform.lower() in card_text.lower():
                            platforms.append(platform)

                    # Start date
                    date_match = re.search(
                        r"(Started running on|Runs since|Began|Ativo desde|Rodando desde)[:\s]+([A-Za-zé\d ,]+\d{4})",
                        card_text,
                        re.IGNORECASE,
                    )
                    start_date = date_match.group(2).strip() if date_match else ""

                    results.append(
                        {
                            "page_name": page_name or "—",
                            "ad_text": ad_text,
                            "copies": copies,
                            "platforms": platforms,
                            "start_date": start_date,
                            "ad_link": ad_link,
                            "page_link": page_link,
                        }
                    )

                # Scroll down to load more
                await page.evaluate("window.scrollBy(0, 2000)")
                await page.wait_for_timeout(2500)
                scroll_attempts += 1

        except PlaywrightTimeout:
            pass
        except Exception as e:
            print(f"Scraper error: {e}")
        finally:
            await browser.close()

    return results
