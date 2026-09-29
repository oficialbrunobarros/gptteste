import asyncio, sys, json, os, re
from playwright.async_api import async_playwright

SP = "/tmp/claude-0/-home-user-gptteste/dc82c9fb-d7d3-5f13-8ce3-d88c1d194354/scratchpad"
URLS = {
 "pageid": "https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=BR&view_all_page_id=100069618833787&search_type=page&media_type=all",
 "kw1": "https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=BR&q=odonto%20brasil%20implantes&search_type=keyword_unordered&media_type=all",
 "kw2": "https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=BR&q=clinicaodontobrasil&search_type=keyword_unordered",
}
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"

async def main():
    which = sys.argv[1:] or list(URLS)
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True, proxy={"server": os.environ.get("HTTPS_PROXY")}, args=["--ignore-certificate-errors"])
        ctx = await b.new_context(user_agent=UA, viewport={"width":1400,"height":2000}, locale="pt-BR", ignore_https_errors=True)
        for k in which:
            page = await ctx.new_page()
            try:
                resp = await page.goto(URLS[k], wait_until="domcontentloaded", timeout=90000)
                print(k, "status", resp.status if resp else None, page.url)
                await page.wait_for_timeout(9000)
                for i in range(6):
                    await page.mouse.wheel(0, 3000); await page.wait_for_timeout(2500)
                await page.screenshot(path=f"{SP}/adlib_{k}.png", full_page=True)
                txt = await page.inner_text("body")
                open(f"{SP}/adlib_{k}.txt","w").write(txt)
                html = await page.content()
                open(f"{SP}/adlib_{k}.html","w").write(html)
                print(k, "len", len(txt)); print(txt[:1500].replace("\n"," | "))
            except Exception as e:
                print(k, "ERR", repr(e)[:400])
                try: await page.screenshot(path=f"{SP}/adlib_{k}_err.png")
                except: pass
            await page.close()
        await b.close()
asyncio.run(main())
