-- Links to other .md files are dead in a standalone document: keep only their text.
function Link(el)
  if el.target:match("%.md$") or el.target:match("%.md#") then
    return el.content
  end
end
