import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { buildWhoDataSourceOptions } from './options';

export const WhoDataSource = new DataSource(buildWhoDataSourceOptions());
