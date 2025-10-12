import type { INodeProperties } from 'n8n-workflow';

type TypedOption<Def> = Def extends { options: Array<{ value: infer Value }> } ? Value : never;

type TypedNodeProperty<Def> = Def extends {
	name: infer Name extends string;
	type: infer Type;
}
	? {
			[name in Name]: Type extends 'string'
				? string
				: Type extends 'boolean'
					? boolean
					: Type extends 'options'
						? TypedOption<Def>
						: never;
		}
	: never;

type TypedNodePropertyList<Defs> = Defs extends [infer Def, ...infer Rest]
	? TypedNodeProperty<Def> & TypedNodePropertyList<Rest>
	: object;

type Agg<T> = { [K in keyof T]: T[K] };

export type TypedNodeProperties<Defs extends INodeProperties[]> = Agg<TypedNodePropertyList<Defs>>;
