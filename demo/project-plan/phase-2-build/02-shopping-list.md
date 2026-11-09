# Shopping list

Adds up every ingredient in the week's [meal plan](../GLOSSARY.md), merges duplicates, and groups items by shop aisle.

```js
function addUp(items) {
  const totals = new Map();
  for (const { name, amount } of items) totals.set(name, (totals.get(name) || 0) + amount);
  return totals;
}
```
