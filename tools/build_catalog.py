#!/usr/bin/env python3
import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path


def source_ids(config, product):
    return product.get("sources", [item["id"] for item in config["sources"]])


def parse_file(filename, product_id, product, valid_sources):
    prefix = f"{product_id}_"
    if not filename.startswith(prefix):
        return None

    tail = filename.removeprefix(prefix)
    if product["view"] == "station-times":
        match = re.fullmatch(r"(\d{4}-\d{2}-\d{2})_(\d{2})_(.+)", tail)

        if not match:
            return None

        location_ids = {location["id"] for location in product["locations"]}

        if match.group(3) not in location_ids:
            return None

        return {
            "date": match.group(1),
            "time": match.group(2),
            "location": match.group(3),
        }
    source = next(
        (item for item in sorted(valid_sources, key=len, reverse=True)
         if tail.startswith(f"{item}_")),
        None,
    )
    if not source:
        return None

    tail = tail.removeprefix(f"{source}_")

    if product["view"] == "map":
        match = re.fullmatch(r"(\d{4}-\d{2}-\d{2})_(\d{2})", tail)
        if not match:
            return None
        return {"source": source, "date": match.group(1), "time": match.group(2)}

    if product["view"] == "station":
        match = re.fullmatch(r"(\d{4}-\d{2}-\d{2})_(.+)", tail)
        if not match:
            return None

        location_ids = {location["id"] for location in product["locations"]}
        if match.group(2) not in location_ids:
            return None

        return {
            "source": source,
            "date": match.group(1),
            "location": match.group(2),
        }

    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="public/config/products.json")
    parser.add_argument("--images-dir", default="public/graphics")
    parser.add_argument("--public-dir", default="public")
    parser.add_argument("--output", default="public/catalog.json")
    args = parser.parse_args()

    config = json.loads(Path(args.config).read_text())
    image_dir = Path(args.images_dir)
    public_dir = Path(args.public_dir)

    catalog = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "products": {product_id: [] for product_id in config["products"]},
    }

    seen = set()

    for image in sorted(image_dir.rglob("*.png")):
        relative_url = image.relative_to(public_dir).as_posix()
        stem = image.stem

        for product_id, product in config["products"].items():
            parsed = parse_file(
                stem,
                product_id,
                product,
                source_ids(config, product),
            )

            if not parsed:
                continue

            key = (product_id, *sorted(parsed.items()))
            if key in seen:
                print(f"Duplicate ignored: {relative_url}")
                break

            seen.add(key)
            parsed["file"] = relative_url
            catalog["products"][product_id].append(parsed)
            break

    for records in catalog["products"].values():
        records.sort(key=lambda item: (
            item["date"],
            item.get("time", ""),
            item.get("location", ""),
            item.get("source",""),
        ))

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(catalog, indent=2))
    print(f"Catalog written: {output}")


if __name__ == "__main__":
    main()
