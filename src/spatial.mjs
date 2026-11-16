function assert(condition, message) {
    if (!condition) throw new Error(message)
}

export function isSpatialGroup(object) {
    return object.spatial !== undefined && object.spatial.group === true
}

export function spatialParent(object) {
    return object.spatial === undefined ? "" : object.spatial.parent || ""
}

export function validateSpatial(objects) {
    const ids = new Map()
    for (const object of objects) {
        if (object.spatial === undefined) continue
        const spatial = object.spatial
        assert(spatial && typeof spatial === "object" && !Array.isArray(spatial), "world spatial must be an object")
        assert(typeof spatial.id === "string" && spatial.id.length > 0, "world spatial.id must be non-empty string")
        for (const key of Object.keys(spatial)) assert(["id", "parent", "group"].includes(key), `world unknown spatial.${key}`)
        assert(!ids.has(spatial.id), `world duplicate spatial id ${spatial.id}`)
        if (Object.hasOwn(spatial, "parent")) assert(typeof spatial.parent === "string" && spatial.parent.length > 0, "world spatial.parent must be non-empty string")
        if (Object.hasOwn(spatial, "group")) assert(spatial.group === true, "world spatial.group must be true when present")
        ids.set(spatial.id, object)
    }
    const visited = new Set()
    const visiting = new Set()
    function visit(object) {
        if (visited.has(object)) return
        assert(!visiting.has(object), "world spatial parent cycle")
        visiting.add(object)
        const parentId = spatialParent(object)
        if (parentId) {
            const parent = ids.get(parentId)
            assert(parent, `world missing spatial parent ${parentId}`)
            assert(isSpatialGroup(parent), `world spatial parent ${parentId} is not a group`)
            visit(parent)
        }
        visiting.delete(object)
        visited.add(object)
    }
    objects.forEach(visit)
}

export function worldPosition(objects, object) {
    let x = object.x
    let y = object.y
    let parent = spatialParent(object)
    const visited = new Set()
    while (parent) {
        assert(!visited.has(parent), "world spatial parent cycle")
        visited.add(parent)
        const group = objects.find((candidate) => candidate.spatial !== undefined && candidate.spatial.id === parent)
        assert(group && isSpatialGroup(group), `world missing spatial group ${parent}`)
        x += group.x
        y += group.y
        parent = spatialParent(group)
    }
    return { x, y }
}

export function spatialDescendants(objects, group) {
    const result = new Set([group.editorId])
    let changed = true
    while (changed) {
        changed = false
        for (const object of objects) {
            if (result.has(object.editorId)) continue
            if (objects.some((candidate) => result.has(candidate.editorId) && candidate.spatial !== undefined && candidate.spatial.id === spatialParent(object))) {
                result.add(object.editorId)
                changed = true
            }
        }
    }
    return result
}
