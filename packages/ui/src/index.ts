/** Formatting shared across platforms; earnings are records, not proof of payment. */
export const formatMoney = (cents: number): string => {
  if (!Number.isSafeInteger(cents)) throw new Error('Valor monetário inválido');
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
};
export const earningsDisclaimer =
  'Valores de entregas concluídas. O pagamento é feito diretamente entre estabelecimento e entregador.';
