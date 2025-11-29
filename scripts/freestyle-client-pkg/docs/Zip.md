# Zip


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**url** | **str** |  | 
**dir** | **str** |  | [optional] 
**commit_message** | **str** |  | 
**author_name** | **str** |  | [optional] 
**author_email** | **str** |  | [optional] 
**type** | **str** |  | 

## Example

```python
from freestyle_client.models.zip import Zip

# TODO update the JSON string below
json = "{}"
# create an instance of Zip from a JSON string
zip_instance = Zip.from_json(json)
# print the JSON string representation of the object
print(Zip.to_json())

# convert the object into a dict
zip_dict = zip_instance.to_dict()
# create an instance of Zip from a dict
zip_from_dict = Zip.from_dict(zip_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


