import type { TSESTree } from '@typescript-eslint/utils';
import { AST_NODE_TYPES } from '@typescript-eslint/utils';
import * as tsutils from 'tsutils';
import * as ts from 'typescript';

import * as util from '../util';

export default util.createRule({
  name: 'prefer-at',
  meta: {
    type: 'suggestion',
    fixable: 'code',
    docs: {
      description:
        'Enforce the use of `array.at(-1)` instead of `array[array.length - 1]`',
      recommended: false,
      requiresTypeChecking: true,
    },
    messages: {
      preferAt:
        'Expected a `{{name}}.at(-1)` instead of `{{name}}[{{name}}.length - 1]`.',
    },
    schema: [
      {
        oneOf: [
          {
            type: 'object',
            properties: {
              ignoreFunctions: {
                type: 'boolean',
              },
            },
            additionalProperties: false,
          },
        ],
      },
    ],
  },
  defaultOptions: [
    {
      ignoreFunctions: false,
    },
  ],
  create(context, [options]) {
    const parserServices = util.getParserServices(context);
    const checker = parserServices.program.getTypeChecker();
    const sourceCode = context.getSourceCode();

    function getName(node: TSESTree.Node): string | undefined {
      switch (node.type) {
        case AST_NODE_TYPES.Identifier:
          return node.name;
        case AST_NODE_TYPES.MemberExpression:
          return getName(node.property);
        default:
          return undefined;
      }
    }

    function getFullName(node: TSESTree.Node): string {
      return sourceCode.text.slice(node.range[0], node.range[1]);
    }

    function hasCallExpression(node: TSESTree.MemberExpression): boolean {
      return (
        node.object.type === AST_NODE_TYPES.CallExpression ||
        (node.object.type === AST_NODE_TYPES.MemberExpression &&
          hasCallExpression(node.object))
      );
    }

    function getTypeAtLocation(node: TSESTree.Node): ts.Type {
      return checker.getTypeAtLocation(
        parserServices.esTreeNodeToTSNodeMap.get(node),
      );
    }

    type SupportedObject = (type: ts.Type) => boolean;

    function checkObjectName(name: string): SupportedObject {
      return type => type.getSymbol()?.name === name;
    }

    function checkObjectType(flags: ts.TypeFlags): SupportedObject {
      return type => type.getFlags() === flags;
    }

    const supporterObjects: Array<SupportedObject> = [
      checkObjectName('Array'),
      checkObjectName('Int8Array'),
      checkObjectName('Uint8Array'),
      checkObjectName('Uint8ClampedArray'),
      checkObjectName('Int16Array'),
      checkObjectName('Uint16Array'),
      checkObjectName('Int32Array'),
      checkObjectName('Float32Array'),
      checkObjectName('Uint32Array'),
      checkObjectName('Float64Array'),
      checkObjectName('BigInt64Array'),
      checkObjectName('BigUint64Array'),
      // eslint-disable-next-line @typescript-eslint/internal/prefer-ast-types-enum
      checkObjectName('String'),
      checkObjectType(ts.TypeFlags.String),
    ];

    function isSupportedObject(type: ts.Type): boolean {
      return supporterObjects.some(check => check(type));
    }

    function isExpectedObject(
      node: TSESTree.Node,
    ): node is TSESTree.MemberExpression {
      if (
        node.type !== AST_NODE_TYPES.MemberExpression ||
        (options.ignoreFunctions && hasCallExpression(node))
      ) {
        return false;
      }
      const type = getTypeAtLocation(node.object);
      if (!isSupportedObject(type)) {
        return false;
      }
      const atMember = type.getProperty('at');
      return Boolean(atMember);
    }

    function isExpectedExpressionLeft(
      node: TSESTree.BinaryExpression,
    ): boolean {
      if (!isExpectedObject(node.left) || getName(node.left) !== 'length') {
        return false;
      }
      const type = getTypeAtLocation(node.left);
      return tsutils.isTypeFlagSet(type, ts.TypeFlags.NumberLike);
    }

    function isExpectedExpressionRight(
      node: TSESTree.BinaryExpression,
    ): boolean {
      const type = getTypeAtLocation(node.right);
      return tsutils.isTypeFlagSet(type, ts.TypeFlags.NumberLike);
    }

    function isExpectedExpression<T extends TSESTree.BinaryExpression>(
      node: T,
    ): node is T & { left: TSESTree.MemberExpression } {
      return isExpectedExpressionRight(node) && isExpectedExpressionLeft(node);
    }

    return {
      'MemberExpression[property.type="BinaryExpression"][property.operator="-"]'(
        node: TSESTree.MemberExpressionComputedName & {
          property: TSESTree.BinaryExpression & { operator: '-' };
        },
      ): void {
        if (!isExpectedExpression(node.property)) {
          return;
        }
        const objectName = getFullName(node.object);
        const memberName = getFullName(node.property.left.object);
        const rightName = getFullName(node.property.right);
        if (objectName !== memberName) {
          return;
        }
        context.report({
          messageId: 'preferAt',
          data: {
            name: objectName,
          },
          node,
          fix: fixer =>
            fixer.replaceText(node, `${objectName}.at(-${rightName})`),
        });
      },
    };
  },
});
