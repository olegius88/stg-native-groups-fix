# STG Native Tab Groups Fix

Расширение для Mozilla Firefox (`Manifest V2`), которое устраняет конфликт между **Simple Tab Groups (STG)** и нативными группами вкладок Firefox (`browser.tabGroups`, Firefox 138+ / 142+).

## Как работает
- Когда STG скрывает вкладки неактивной группы (`browser.tabs.hide`), нативные группы вкладок Firefox по умолчанию игнорируют атрибут `hidden` у вкладок внутри `tab-group`.
- Расширение автоматически снимает нативную группировку со скрытых вкладок при переключении группы STG (позволяя Firefox корректно скрыть их с панели вкладок) и восстанавливает нативные группы с исходным названием и цветом при возврате в группу.
- При отключении или удалении расширения все сохранённые нативные группы вкладок автоматически восстанавливаются.

## Ссылки
- **Mozilla Add-ons**: `https://addons.mozilla.org/ru/firefox/addon/stg-native-tab-groups-fix/`
- **CSS-версия без перегруппировки вкладок (`userChrome.css`)**: `https://github.com/olegius88/stg-native-groups-css-fix`
- **Зеркальная фоновая синхронизация вкладок и групп (`STG Sync Tab Mirror`)**: `https://github.com/olegius88/stg-firefox-sync-tab-mirror`
