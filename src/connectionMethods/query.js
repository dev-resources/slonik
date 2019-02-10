// @flow

import serializeError from 'serialize-error';
import {
  createQueryId
} from '../utilities';
import {
  CheckIntegrityConstraintViolationError,
  ForeignKeyIntegrityConstraintViolationError,
  NotNullIntegrityConstraintViolationError,
  UniqueIntegrityConstraintViolationError
} from '../errors';
import type {
  InternalQueryFunctionType,
  LoggerType,
  QueryContextType
} from '../types';

const getPoolId = (log: LoggerType): string => {
  const poolId = log.getContext().poolId;

  if (typeof poolId !== 'string') {
    throw new TypeError('Unexpected state.');
  }

  return poolId;
};

const getConnectionId = (log: LoggerType): string => {
  const connectionId = log.getContext().connectionId;

  if (typeof connectionId !== 'string') {
    throw new TypeError('Unexpected state.');
  }

  return connectionId;
};

const getTransactionId = (log: LoggerType): string | void => {
  const poolId = log.getContext().transactionId;

  if (typeof poolId !== 'string' && typeof poolId !== 'undefined') {
    throw new TypeError('Unexpected state.');
  }

  return poolId;
};

const query: InternalQueryFunctionType<*> = async (connectionLogger, connection, clientConfiguration, rawSql, values, inheritedQueryId) => {
  const queryId = inheritedQueryId || createQueryId();

  const log = connectionLogger.child({
    queryId
  });

  const originalQuery = {
    sql: rawSql,
    values
  };

  let actualQuery = {
    ...originalQuery
  };

  const executionContext: QueryContextType = {
    connectionId: getConnectionId(log),
    log,
    originalQuery,
    poolId: getPoolId(log),
    queryId,
    transactionId: getTransactionId(log)
  };

  for (const interceptor of clientConfiguration.interceptors) {
    if (interceptor.transformQuery) {
      actualQuery = await interceptor.transformQuery(executionContext, actualQuery);
    }
  }

  let result;

  for (const interceptor of clientConfiguration.interceptors) {
    if (interceptor.beforeQueryExecution) {
      result = await interceptor.beforeQueryExecution(executionContext, actualQuery);

      if (result) {
        return result;
      }
    }
  }

  try {
    result = await connection.query(actualQuery.sql, actualQuery.values);
  } catch (error) {
    log.error({
      error: serializeError(error),
      queryId
    }, 'query produced an error');

    if (error.code === '23502') {
      throw new NotNullIntegrityConstraintViolationError(error.constraint);
    }

    if (error.code === '23503') {
      throw new ForeignKeyIntegrityConstraintViolationError(error.constraint);
    }

    if (error.code === '23505') {
      throw new UniqueIntegrityConstraintViolationError(error.constraint);
    }

    if (error.code === '23514') {
      throw new CheckIntegrityConstraintViolationError(error.constraint);
    }

    throw error;
  }

  for (const interceptor of clientConfiguration.interceptors) {
    if (interceptor.afterQueryExecution) {
      result = await interceptor.afterQueryExecution(executionContext, actualQuery, result);
    }
  }

  return result;
};

export default query;
