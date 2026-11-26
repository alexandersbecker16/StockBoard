# StockBoard

A live stock dashboard that runs locally on your computer. Pure Python standard library, so there's nothing to install beyond Python 3.

## Run it

Double-click `start.bat`, or run:

```
python server.py
```

Your browser opens to http://localhost:8050. Use `--port 9000` to change the port, or `--no-browser` to skip opening a tab.

## Features

- **Watchlist of your choosing:** search by ticker or company name to add stocks, ETFs, indexes (`^GSPC`), or crypto (`BTC-USD`). Hover a card and click × to remove one. The list is saved to `watchlist.json`.
- **Live prices:** refreshes every 5s/15s/30s/1m (or paused). Prices flash green/red when they tick.
- **Intraday sparkline** on every card, with the previous close shown as a dotted line.
- **Summary strip:** advancing/declining count, average move, best and worst today.
- **Detail chart:** click any card for an interactive chart (1D, 5D, 1M, 6M, 1Y, 5Y) with a hover crosshair, plus day range, 52-week range, and volume.
- **Sort** by your own order, top gainers, top losers, or A→Z.
- Light and dark mode follow your system setting.

Data comes from Yahoo Finance's public endpoints and may be delayed. Not investment advice.
