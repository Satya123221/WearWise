UPDATE `wardrobe_items` SET `wears_since_wash` = `worn_count` % (
	CASE
		WHEN `slot` = 'accessory' THEN 21
		WHEN `slot` = 'shoes' THEN 16
		WHEN lower(`category`) LIKE '%blazer%' THEN 9
		WHEN `slot` = 'outerwear' THEN 7
		WHEN lower(`category`) LIKE '%jeans%' OR lower(`material`) LIKE '%denim%' THEN 7
		WHEN `slot` = 'ethnic' OR lower(`category`) LIKE '%kurta%' THEN 4
		WHEN `slot` = 'bottom' THEN 5
		ELSE 3
	END
);
