# AccessTokenInfo


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **str** |  | 

## Example

```python
from freestyle_client.models.access_token_info import AccessTokenInfo

# TODO update the JSON string below
json = "{}"
# create an instance of AccessTokenInfo from a JSON string
access_token_info_instance = AccessTokenInfo.from_json(json)
# print the JSON string representation of the object
print(AccessTokenInfo.to_json())

# convert the object into a dict
access_token_info_dict = access_token_info_instance.to_dict()
# create an instance of AccessTokenInfo from a dict
access_token_info_from_dict = AccessTokenInfo.from_dict(access_token_info_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


