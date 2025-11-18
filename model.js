import assert from 'node:assert';
import { ConflictError, NotFoundError, UnacknowledgedError } from './error.js';
import { isDuplicationError, } from './mongo.js';
import { Nil, isNullish } from './type.js';
export { isDuplicationError } from './mongo.js';
export const TIMESTAMP_SCHEMA = {
    created_at: { bsonType: 'date' },
    updated_at: { bsonType: 'date' },
};
export const NUMBER_DOC_SCHEMA = {
    _id: { type: 'number' },
    ...TIMESTAMP_SCHEMA,
};
export const STRING_DOC_SCHEMA = {
    _id: { type: 'string' },
    ...TIMESTAMP_SCHEMA,
};
export const UUID_DOC_SCHEMA = {
    _id: { bsonType: 'binData' },
    ...TIMESTAMP_SCHEMA,
};
export const OBJECTID_DOC_SCHEMA = {
    _id: { bsonType: 'binData' },
    ...TIMESTAMP_SCHEMA,
};
export class Model {
    id;
    createdAt;
    updatedAt;
    constructor(doc) {
        this.id = doc._id;
        this.createdAt = doc.created_at;
        this.updatedAt = doc.updated_at;
    }
}
function isModelLike(x) {
    return (typeof x === 'object' &&
        x !== null &&
        'id' in x &&
        'createdAt' in x &&
        x.createdAt instanceof Date &&
        'updatedAt' in x &&
        (x.updatedAt === Nil || x.updatedAt instanceof Date));
}
export function pickId(x) {
    return isModelLike(x) ? x.id : x;
}
export function pickIdOrNil(x) {
    return isNullish(x) ? Nil : pickId(x);
}
export class Models {
    connection;
    constructor(options) {
        this.connection = options.connection;
    }
    get collection() {
        return this.connection.db.collection(this.name, {
            ignoreUndefined: true,
        });
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    $query(query, options) {
        return {};
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    $inc(values, options) {
        return {};
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    $set(values, options) {
        return {};
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    $unset(values, options) {
        return {};
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    $sort(sort) {
        return Nil;
    }
    async find(id, options = {}) {
        const _id = pickId(id);
        if (_id !== id)
            return id;
        const found = await this.collection.findOne({ _id }, options);
        if (isNullish(found))
            throw new NotFoundError(`Not Found: ${this.name}`);
        return this.$model(found, options);
    }
    async findOne(query = {}, options = {}) {
        const found = await this.collection.findOne(this.$query(query, options), options);
        return isNullish(found) ? Nil : this.$model(found, options);
    }
    async findMany(query = {}, pagination = {}, options = {}) {
        return await this.iterate(query, pagination, options).toArray(options);
    }
    async findManyToMapBy(by, query = {}, pagination = {}, options = {}) {
        const map = new Map();
        const cursor = this.iterate(query, pagination, options);
        for await (const x of cursor)
            map.set(by(x), x);
        return map;
    }
    iterate(query = {}, pagination = {}, options = {}) {
        const cursor = this.collection.find(this.$query(query, options), options);
        const { offset, limit } = pagination;
        const sort = this.$sort(pagination.sort);
        if (!isNullish(sort))
            cursor.sort(sort);
        if (!isNullish(offset))
            cursor.skip(offset);
        if (!isNullish(limit))
            cursor.limit(limit);
        return new Cursor((x) => this.$model(x, options), cursor);
    }
    async paginate(query = {}, pagination = {}, options = {}) {
        const max = 1000;
        const { offset = 0 } = pagination;
        const limit = Math.min(pagination.limit ?? max, max);
        assert(offset >= 0 && Number.isInteger(offset));
        assert(limit >= 0 && limit <= max && Number.isInteger(limit));
        const filter = this.$query(query);
        const count = await this.collection.countDocuments(filter, options);
        const cursor = this.collection.find(filter, options);
        const sort = this.$sort(pagination.sort);
        if (!isNullish(sort))
            cursor.sort(sort);
        const docs = await cursor.skip(offset).limit(limit).toArray();
        return [
            { sort: pagination.sort, offset, limit, count },
            docs.map((x) => this.$model(x, options)),
        ];
    }
    async count(query = {}, options = {}) {
        return await this.collection.countDocuments(this.$query(query, options), options);
    }
    async insertOne(values, options = {}) {
        try {
            const $options = { ...options, $now: options.$now ?? new Date() };
            const inserted = {
                created_at: $options.$now,
                ...this.$insert(values, $options),
            };
            const { acknowledged } = await this.collection.insertOne(inserted, $options);
            if (acknowledged)
                return this.$model(inserted, $options);
        }
        catch (err) {
            throw isDuplicationError(err)
                ? new ConflictError(`Conflict: ${this.name}`)
                : err;
        }
        throw new UnacknowledgedError();
    }
    async insertMany(values, options = {}) {
        if (values.length === 0)
            return [];
        try {
            const $options = { ...options, $now: options.$now ?? new Date() };
            const inserted = values.map((x) => ({
                created_at: $options.$now,
                ...this.$insert(x, $options),
            }));
            const { acknowledged } = await this.collection.insertMany(inserted, $options);
            if (acknowledged)
                return inserted.map((x) => this.$model(x, $options));
        }
        catch (err) {
            throw isDuplicationError(err)
                ? new ConflictError(`Conflict: ${this.name}`)
                : err;
        }
        throw new UnacknowledgedError();
    }
    async updateOne(id, values, options = {}) {
        const $options = { ...options, $now: options.$now ?? new Date() };
        const updated = await this.collection.findOneAndUpdate({ _id: pickId(id) }, {
            $inc: this.$inc(values, $options),
            $set: { updated_at: $options.$now, ...this.$set(values, $options) },
            $unset: this.$unset(values, $options),
        }, { returnDocument: 'after', ...$options });
        if (isNullish(updated))
            throw new NotFoundError(`Not Found: ${this.name}`);
        return this.$model(updated, $options);
    }
    async updateMany(query, values, options = {}) {
        const $options = { ...options, $now: options.$now ?? new Date() };
        const { modifiedCount } = await this.collection.updateMany(this.$query(query, $options), {
            $inc: this.$inc(values, $options),
            $set: { updated_at: $options.$now, ...this.$set(values, $options) },
            $unset: this.$unset(values, $options),
        }, $options);
        return modifiedCount;
    }
    async deleteOne(id, options = {}) {
        const { deletedCount } = await this.collection.deleteOne({ _id: pickId(id) }, options);
        if (deletedCount !== 1)
            throw new NotFoundError(`Not Found: ${this.name}`);
    }
    async deleteMany(query = {}, options = {}) {
        const { deletedCount } = await this.collection.deleteMany(this.$query(query, options), options);
        return deletedCount;
    }
}
export class Cursor {
    #model;
    #cursor;
    constructor(model, cursor) {
        this.#model = model;
        this.#cursor = cursor;
    }
    async *[Symbol.asyncIterator]() {
        try {
            for await (const x of this.#cursor) {
                yield this.#model(x);
            }
        }
        finally {
            await this.#cursor.close();
        }
    }
    async toArray(options) {
        return (await this.#cursor.toArray()).map((x) => this.#model(x, options));
    }
}
export function getSortKey(sort) {
    if (typeof sort === 'string')
        return sort;
    if (Array.isArray(sort)) {
        if (sort.length === 0)
            return Nil;
        // [string, SortDirection][]
        if (Array.isArray(sort[0])) {
            return sort[0][0];
        }
        // string[]
        return sort[0];
    }
    if (sort instanceof Map) {
        const first = sort.keys().next();
        return first.done ? Nil : first.value;
    }
    if (typeof sort === 'object' && !isNullish(sort)) {
        return Object.keys(sort)[0];
    }
    return Nil;
}
export function toValueOrAbsent(value) {
    return isNullish(value) ? { $exists: false } : value;
}
export function toValueOrAbsentOrNil(values, key, map = (x) => isNullish(x) ? Nil : x) {
    return key in values ? toValueOrAbsent(map(values[key])) : Nil;
}
export function toExistsOrNil($exists) {
    return isNullish($exists) ? Nil : { $exists };
}
export function toUnsetOrNil(values, key) {
    return key in values && isNullish(values[key]) ? true : Nil;
}
export function toValueOrInOrNil(x, map = (x) => x) {
    if (isNullish(x))
        return Nil;
    if (Array.isArray(x))
        return { $in: x.map(map) };
    return map(x);
}
export function toRangeOrNil({ begin, end, } = {}, inclusiveEnd = false) {
    return isNullish(begin) && isNullish(end)
        ? Nil
        : { $gte: begin, [inclusiveEnd ? '$lte' : '$lt']: end };
}
//# sourceMappingURL=model.js.map